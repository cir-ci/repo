import { isSnoozed, overdueBy } from '@circi/core'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, not, or, sql } from 'drizzle-orm'

import {
  builds,
  member,
  workspace,
  teams,
  type ReviewRequestState,
  reviewRequests,
  screenshotDiffs,
  screenshots,
  type SnoozeKind,
  user,
} from '#schema/index.ts'
import { workspaceAccepts, type SessionMethod } from '#shared/session-method.ts'
import type { Database } from '#src/client.ts'
import type { Build } from '#src/types.ts'

/**
 * The review requests a person sees on the Reviews page, across the workspaces they belong
 * to (PLAN §8: workspace isolation). Open requests only; closed ones are history.
 */

/** `for-you`: asked of you and awake. `created`: asked by you. `snoozed`: asked of you, put off. */
export const REVIEW_TABS = ['for-you', 'created', 'snoozed'] as const
export namespace listReviewRequests {
  export type Tab = (typeof REVIEW_TABS)[number]

  export interface Item {
    id: string
    state: ReviewRequestState
    createdAt: Date
    /** When the team's review target runs out; null when the team has none. */
    dueAt: Date | null
    /** Milliseconds past `dueAt`; 0 when on time, snoozed or without a target. */
    overdueByMs: number
    snoozedUntil: Date | null
    snoozeKind: SnoozeKind | null
    reviewer: { id: string; name: string }
    /** Null when whoever asked has since left. */
    requestedBy: { id: string; name: string } | null
    build: {
      number: number
      branch: string | null
      prNumber: number | null
      commitSha: string
      status: Build['status']
      conclusion: Build['conclusion']
      reviewStatus: Build['reviewStatus']
    }
    team: { slug: string; name: string }
    workspace: { slug: string; name: string }
    /** How the build's screenshots compare with the baseline. */
    changes: Changes
    /** The (up to two) changed screenshots with the highest diff score, biggest first. */
    largestChanges: LargestChange[]
  }

  export interface Changes {
    changed: number
    added: number
    removed: number
    unchanged: number
  }

  export interface LargestChange {
    name: string
    /** Fraction of the screenshot that differs, 0 to 1; null when not measured. */
    score: number | null
    /** The head image and its thumbnail; null for a screenshot with no head image. */
    sha256: string | null
    thumbnail: string | null
  }
}

/**
 * One tab of the Reviews page, most urgent first: soonest due, requests without a due time last,
 * then newest. `now` decides what is snoozed and overdue.
 */
export async function listReviewRequests(
  db: Database,
  input: { userId: string; tab: listReviewRequests.Tab; now: Date; method?: SessionMethod },
): Promise<listReviewRequests.Item[]> {
  const snoozed =
    and(
      isNotNull(reviewRequests.snoozeKind),
      or(isNull(reviewRequests.snoozedUntil), gt(reviewRequests.snoozedUntil, input.now)),
    ) ?? sql`false`
  const scope =
    input.tab === 'created'
      ? eq(reviewRequests.requestedById, input.userId)
      : and(
          eq(reviewRequests.reviewerId, input.userId),
          input.tab === 'snoozed' ? snoozed : not(snoozed),
        )

  const rows = await db
    .select({
      request: reviewRequests,
      reviewer: { id: user.id, name: user.name },
      build: {
        number: builds.number,
        branch: builds.branch,
        prNumber: builds.prNumber,
        commitSha: builds.commitSha,
        status: builds.status,
        conclusion: builds.conclusion,
        reviewStatus: builds.reviewStatus,
      },
      team: { slug: teams.slug, name: teams.name },
      workspace: { slug: workspace.slug, name: workspace.name },
    })
    .from(reviewRequests)
    .innerJoin(builds, eq(builds.id, reviewRequests.buildId))
    .innerJoin(teams, eq(teams.id, builds.teamId))
    .innerJoin(workspace, eq(workspace.id, teams.workspaceId))
    .innerJoin(member, and(eq(member.workspaceId, workspace.id), eq(member.userId, input.userId)))
    .innerJoin(user, eq(user.id, reviewRequests.reviewerId))
    .where(
      and(eq(reviewRequests.state, 'open'), scope, workspaceAccepts(workspace.id, input.method)),
    )
    .orderBy(
      sql`${reviewRequests.dueAt} asc nulls last`,
      desc(reviewRequests.createdAt),
      asc(reviewRequests.id),
    )

  // Looked up apart from the rows: joining the user table twice, once optionally, makes
  // Drizzle's result type collapse.
  const askerIds = [...new Set(rows.flatMap((r) => r.request.requestedById ?? []))]
  const askers = new Map(
    askerIds.length === 0
      ? []
      : (
          await db
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(inArray(user.id, askerIds))
        ).map((u) => [u.id, u.name]),
  )

  const buildIds = [...new Set(rows.map((r) => r.request.buildId))]
  const { changes, largest } = await loadChanges(db, buildIds)

  return rows.map((r) => {
    const asleep = isSnoozed(r.request, input.now)
    return {
      id: r.request.id,
      state: r.request.state,
      createdAt: r.request.createdAt,
      dueAt: r.request.dueAt,
      overdueByMs: overdueBy(r.request.dueAt, input.now, asleep),
      snoozedUntil: r.request.snoozedUntil,
      snoozeKind: r.request.snoozeKind,
      reviewer: r.reviewer,
      requestedBy: askerOf(r.request.requestedById, askers),
      build: r.build,
      team: r.team,
      workspace: r.workspace,
      changes: changes.get(r.request.buildId) ?? { changed: 0, added: 0, removed: 0, unchanged: 0 },
      largestChanges: largest.get(r.request.buildId) ?? [],
    }
  })
}

/** Counts by diff status, and the two highest-scoring changed screenshots, per build. */
async function loadChanges(db: Database, buildIds: string[]) {
  const changes = new Map<string, listReviewRequests.Changes>()
  const largest = new Map<string, listReviewRequests.LargestChange[]>()
  if (buildIds.length === 0) return { changes, largest }

  const counts = await db
    .select({
      buildId: screenshotDiffs.buildId,
      status: screenshotDiffs.status,
      n: sql<number>`count(*)::int`,
    })
    .from(screenshotDiffs)
    .where(inArray(screenshotDiffs.buildId, buildIds))
    .groupBy(screenshotDiffs.buildId, screenshotDiffs.status)
  for (const c of counts) {
    const entry = changes.get(c.buildId) ?? { changed: 0, added: 0, removed: 0, unchanged: 0 }
    if (c.status === 'changed' || c.status === 'added' || c.status === 'removed') {
      entry[c.status] += c.n
    } else if (c.status === 'unchanged') entry.unchanged += c.n
    changes.set(c.buildId, entry)
  }

  const ranked = db
    .select({
      buildId: screenshotDiffs.buildId,
      name: screenshotDiffs.name,
      score: screenshotDiffs.score,
      sha256: screenshots.fileSha256,
      thumbnail: screenshots.thumbnailSha256,
      rank: sql<number>`row_number() over (partition by ${screenshotDiffs.buildId} order by ${screenshotDiffs.score} desc nulls last, ${screenshotDiffs.name})`.as(
        'rank',
      ),
    })
    .from(screenshotDiffs)
    .leftJoin(screenshots, eq(screenshots.id, screenshotDiffs.headScreenshotId))
    .where(and(inArray(screenshotDiffs.buildId, buildIds), eq(screenshotDiffs.status, 'changed')))
    .as('ranked')
  const top = await db
    .select()
    .from(ranked)
    .where(sql`${ranked.rank} <= 2`)
    .orderBy(asc(ranked.buildId), asc(ranked.rank))
  for (const t of top) {
    const list = largest.get(t.buildId) ?? []
    list.push({ name: t.name, score: t.score, sha256: t.sha256, thumbnail: t.thumbnail })
    largest.set(t.buildId, list)
  }
  return { changes, largest }
}

function askerOf(id: string | null, names: Map<string, string>) {
  const name = id === null ? undefined : names.get(id)
  return id !== null && name !== undefined ? { id, name } : null
}
