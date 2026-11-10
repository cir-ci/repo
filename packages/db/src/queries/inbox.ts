import { overdueBy } from '@circi/core'
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm'

import {
  builds,
  member,
  type NotificationKind,
  notificationPreferences,
  notifications,
  workspace,
  teams,
  reviewRequests,
  screenshotDiffs,
  user,
} from '#schema/index.ts'
import { workspaceAccepts, type SessionMethod } from '#shared/session-method.ts'
import { teamVisibleTo } from '#shared/team-visibility.ts'
import type { Database } from '#src/client.ts'
import type { Build } from '#src/types.ts'

/**
 * A person's inbox: notifications across the workspaces they belong to (PLAN §8: workspace
 * isolation). Deleted ones never show; snoozed ones are hidden until they wake.
 */

/** `for-you`: about you and your work. `everything`: also team-wide notices. `snoozed`: put off. */
export const INBOX_TABS = ['for-you', 'everything', 'snoozed'] as const
export namespace listInbox {
  export type Tab = (typeof INBOX_TABS)[number]

  export interface Item {
    id: string
    kind: NotificationKind
    createdAt: Date
    /** Null while unread. */
    readAt: Date | null
    snoozedUntil: Date | null
    payload: Record<string, unknown>
    /** Null for the system, or when the person has since left. */
    actor: { id: string; name: string; image: string | null } | null
    /** Null for notices that are not about one build. */
    build: {
      number: number
      /** The build's name; "default" for a team's only build per commit. */
      name: string
      branch: string | null
      prNumber: number | null
      commitSha: string
      status: Build['status']
      reviewStatus: Build['reviewStatus']
    } | null
    /** How the build's screenshots compare with the baseline; null without a build. */
    changes: {
      changed: number
      added: number
      removed: number
      unchanged: number
    } | null
    /** The person's open review request for the build: its target and how far past it. */
    request: { dueAt: Date | null; overdueByMs: number } | null
    team: { slug: string; name: string } | null
    workspace: { slug: string; name: string } | null
    /** The same build also waits for this person's review on the Reviews page. */
    alsoInReviews: boolean
  }

  export interface List {
    tab: listInbox.Tab
    /** Unread notifications that are visible now (not snoozed), whatever the tab. */
    unread: number
    items: listInbox.Item[]
  }
}

/** The kinds the "For you" tab shows: everything except team-wide notices. */
export const FOR_YOU_KINDS: readonly NotificationKind[] = [
  'review_requested',
  'review_re_requested',
  'mentioned',
  'build_approved',
  'build_rejected',
  'review_overdue',
  'triage_assigned',
]

const MAX_ITEMS = 200

/** One tab of the inbox, newest first, and how many notifications are unread. */
export async function listInbox(
  db: Database,
  input: {
    userId: string
    tab: listInbox.Tab
    now: Date
    method?: SessionMethod
  },
): Promise<listInbox.List> {
  const asleep = and(
    isNotNull(notifications.snoozedUntil),
    gt(notifications.snoozedUntil, input.now),
  )
  const scope =
    input.tab === 'snoozed'
      ? asleep
      : and(
          not(asleep),
          input.tab === 'for-you' ? inArray(notifications.kind, [...FOR_YOU_KINDS]) : undefined,
        )

  const rows = await db
    .select({
      n: notifications,
      build: {
        id: builds.id,
        number: builds.number,
        name: builds.name,
        branch: builds.branch,
        prNumber: builds.prNumber,
        commitSha: builds.commitSha,
        status: builds.status,
        reviewStatus: builds.reviewStatus,
      },
      team: { slug: teams.slug, name: teams.name },
      workspace: { slug: workspace.slug, name: workspace.name },
      alsoInReviews: sql<boolean>`exists (
        select 1 from ${reviewRequests}
        where ${reviewRequests.buildId} = ${notifications.buildId}
          and ${reviewRequests.reviewerId} = ${notifications.userId}
          and ${reviewRequests.state} = 'open')`,
    })
    .from(notifications)
    .leftJoin(builds, eq(builds.id, notifications.buildId))
    .leftJoin(teams, eq(teams.id, builds.teamId))
    .leftJoin(workspace, eq(workspace.id, teams.workspaceId))
    .leftJoin(member, and(eq(member.workspaceId, workspace.id), eq(member.userId, input.userId)))
    .where(and(visibleWhere(input), scope))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(MAX_ITEMS)

  const actorIds = [...new Set(rows.flatMap((r) => r.n.actorId ?? []))]
  const actors = new Map(
    actorIds.length === 0
      ? []
      : (
          await db
            .select({ id: user.id, name: user.name, image: user.image })
            .from(user)
            .where(inArray(user.id, actorIds))
        ).map((u) => [u.id, { name: u.name, image: u.image }]),
  )

  const buildIds = [...new Set(rows.flatMap((r) => (r.n.buildId === null ? [] : [r.n.buildId])))]
  const counts = new Map<
    string,
    { changed: number; added: number; removed: number; unchanged: number }
  >()
  const open = new Map<string, { dueAt: Date | null; snoozed: boolean }>()
  if (buildIds.length > 0) {
    const grouped = await db
      .select({
        buildId: screenshotDiffs.buildId,
        status: screenshotDiffs.status,
        n: sql<number>`count(*)::int`,
      })
      .from(screenshotDiffs)
      .where(inArray(screenshotDiffs.buildId, buildIds))
      .groupBy(screenshotDiffs.buildId, screenshotDiffs.status)
    for (const g of grouped) {
      const entry = counts.get(g.buildId) ?? {
        changed: 0,
        added: 0,
        removed: 0,
        unchanged: 0,
      }
      if (
        g.status === 'changed' ||
        g.status === 'added' ||
        g.status === 'removed' ||
        g.status === 'unchanged'
      ) {
        entry[g.status] += g.n
      }
      counts.set(g.buildId, entry)
    }
    const requests = await db
      .select({
        buildId: reviewRequests.buildId,
        dueAt: reviewRequests.dueAt,
        snoozeKind: reviewRequests.snoozeKind,
        snoozedUntil: reviewRequests.snoozedUntil,
      })
      .from(reviewRequests)
      .where(
        and(
          inArray(reviewRequests.buildId, buildIds),
          eq(reviewRequests.reviewerId, input.userId),
          eq(reviewRequests.state, 'open'),
        ),
      )
    for (const r of requests) {
      open.set(r.buildId, {
        dueAt: r.dueAt,
        snoozed: r.snoozeKind !== null && (r.snoozedUntil === null || r.snoozedUntil > input.now),
      })
    }
  }

  return {
    tab: input.tab,
    unread: await countUnreadNotifications(db, input),
    items: rows.map((r) => {
      const actorRow = r.n.actorId === null ? undefined : actors.get(r.n.actorId)
      const buildId = r.n.buildId
      const request = buildId === null ? undefined : open.get(buildId)
      return {
        id: r.n.id,
        kind: r.n.kind,
        createdAt: r.n.createdAt,
        readAt: r.n.readAt,
        snoozedUntil: r.n.snoozedUntil,
        payload: r.n.payload,
        actor:
          r.n.actorId !== null && actorRow !== undefined
            ? { id: r.n.actorId, name: actorRow.name, image: actorRow.image }
            : null,
        build:
          r.n.buildId === null || r.build === null
            ? null
            : {
                number: r.build.number,
                name: r.build.name,
                branch: r.build.branch,
                prNumber: r.build.prNumber,
                commitSha: r.build.commitSha,
                status: r.build.status,
                reviewStatus: r.build.reviewStatus,
              },
        changes:
          buildId === null
            ? null
            : (counts.get(buildId) ?? {
                changed: 0,
                added: 0,
                removed: 0,
                unchanged: 0,
              }),
        request: request
          ? {
              dueAt: request.dueAt,
              overdueByMs: overdueBy(request.dueAt, input.now, request.snoozed),
            }
          : null,
        team: r.n.buildId === null ? null : r.team,
        workspace: r.n.buildId === null ? null : r.workspace,
        alsoInReviews: r.alsoInReviews,
      }
    }),
  }
}

/** The number for the sidebar badge: unread, visible and awake. */
export async function countUnreadNotifications(
  db: Database,
  input: { userId: string; now: Date; method?: SessionMethod },
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .leftJoin(builds, eq(builds.id, notifications.buildId))
    .leftJoin(teams, eq(teams.id, builds.teamId))
    .leftJoin(workspace, eq(workspace.id, teams.workspaceId))
    .leftJoin(member, and(eq(member.workspaceId, workspace.id), eq(member.userId, input.userId)))
    .where(
      and(
        visibleWhere(input),
        isNull(notifications.readAt),
        or(isNull(notifications.snoozedUntil), lte(notifications.snoozedUntil, input.now)),
      ),
    )
  return row?.count ?? 0
}

function visibleWhere(input: { userId: string; method?: SessionMethod }): SQL {
  return (
    and(
      eq(notifications.userId, input.userId),
      isNull(notifications.deletedAt),
      or(
        isNull(notifications.buildId),
        and(
          isNotNull(member.userId),
          workspaceAccepts(workspace.id, input.method),
          teamVisibleTo(input.userId, teams),
        ),
      ),
    ) ?? sql`false`
  )
}

function not(condition: SQL | undefined): SQL {
  return sql`not coalesce(${condition}, false)`
}

export namespace getNotificationPreferences {
  export interface Preferences {
    emailReviewRequested: boolean
    emailReviewOverdue: boolean
  }
}

export async function getNotificationPreferences(
  db: Database,
  userId: string,
): Promise<getNotificationPreferences.Preferences> {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
  return row
    ? {
        emailReviewRequested: row.emailReviewRequested,
        emailReviewOverdue: row.emailReviewOverdue,
      }
    : { ...DEFAULT_NOTIFICATION_PREFERENCES }
}

export const DEFAULT_NOTIFICATION_PREFERENCES: getNotificationPreferences.Preferences = {
  emailReviewRequested: true,
  emailReviewOverdue: true,
}
