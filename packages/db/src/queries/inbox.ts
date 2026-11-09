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
  user,
} from '#schema/index.ts'
import { workspaceAccepts, type SessionMethod } from '#shared/session-method.ts'
import type { Database } from '#src/client.ts'

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
    actor: { id: string; name: string } | null
    /** Null for notices that are not about one build. */
    build: {
      number: number
      branch: string | null
      prNumber: number | null
      commitSha: string
    } | null
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
]

const MAX_ITEMS = 200

/** One tab of the inbox, newest first, and how many notifications are unread. */
export async function listInbox(
  db: Database,
  input: { userId: string; tab: listInbox.Tab; now: Date; method?: SessionMethod },
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
        number: builds.number,
        branch: builds.branch,
        prNumber: builds.prNumber,
        commitSha: builds.commitSha,
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
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(inArray(user.id, actorIds))
        ).map((u) => [u.id, u.name]),
  )

  return {
    tab: input.tab,
    unread: await countUnreadNotifications(db, input),
    items: rows.map((r) => {
      const actorName = r.n.actorId === null ? undefined : actors.get(r.n.actorId)
      return {
        id: r.n.id,
        kind: r.n.kind,
        createdAt: r.n.createdAt,
        readAt: r.n.readAt,
        snoozedUntil: r.n.snoozedUntil,
        payload: r.n.payload,
        actor:
          r.n.actorId !== null && actorName !== undefined
            ? { id: r.n.actorId, name: actorName }
            : null,
        build: r.n.buildId === null ? null : r.build,
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
        and(isNotNull(member.userId), workspaceAccepts(workspace.id, input.method)),
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
