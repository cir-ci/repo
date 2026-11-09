import { isSnoozed, overdueBy } from '@circi/core'
import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  not,
  or,
  sql,
} from 'drizzle-orm'

import {
  builds,
  member,
  workspace,
  teams,
  type ReviewRequestState,
  reviewRequests,
  reviews,
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
 * to (PLAN §8: workspace isolation). The tabs show open requests, except `reviewed`: the ones
 * you closed by deciding.
 */

/** The most requests the `reviewed` tab returns: the latest ones you closed. */
export const REVIEWED_LIMIT = 50

/**
 * `for-you`: asked of you and awake. `created`: asked by you. `snoozed`: asked of you, put off.
 * `reviewed`: asked of you and closed since, latest first. `all-open`: every open request in
 * your workspaces, whoever it was asked of.
 */
export const REVIEW_TABS = ['for-you', 'created', 'snoozed', 'reviewed', 'all-open'] as const
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
    /** When the request closed; null while it is open. */
    closedAt: Date | null
    /** The reviewer's own last decision on this build; null while open or when someone else decided. */
    decision: 'approved' | 'rejected' | null
    /** Why this request is not a first ask, when it can be told from the history. */
    reason: Reason | null
    /** The build this one was compared with; null when it had no baseline. */
    baseline: { number: number; branch: string | null } | null
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

  /**
   * `rejected_earlier`: the reviewer rejected an earlier build (`buildNumber`) of the same branch.
   * `re_requested`: the reviewer was asked about this build before, and that request has closed.
   */
  export type Reason = { kind: 'rejected_earlier'; buildNumber: number } | { kind: 're_requested' }

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
  const reviewed = input.tab === 'reviewed'
  const scope =
    input.tab === 'created'
      ? eq(reviewRequests.requestedById, input.userId)
      : input.tab === 'all-open'
        ? sql`true`
        : reviewed
          ? eq(reviewRequests.reviewerId, input.userId)
          : and(
              eq(reviewRequests.reviewerId, input.userId),
              input.tab === 'snoozed' ? snoozed : not(snoozed),
            )

  const query = db
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
      team: { id: teams.id, slug: teams.slug, name: teams.name },
      workspace: { slug: workspace.slug, name: workspace.name },
    })
    .from(reviewRequests)
    .innerJoin(builds, eq(builds.id, reviewRequests.buildId))
    .innerJoin(teams, eq(teams.id, builds.teamId))
    .innerJoin(workspace, eq(workspace.id, teams.workspaceId))
    .innerJoin(member, and(eq(member.workspaceId, workspace.id), eq(member.userId, input.userId)))
    .innerJoin(user, eq(user.id, reviewRequests.reviewerId))
    .where(
      and(
        eq(reviewRequests.state, reviewed ? 'done' : 'open'),
        scope,
        workspaceAccepts(workspace.id, input.method),
      ),
    )
    .orderBy(
      ...(reviewed
        ? [sql`${reviewRequests.closedAt} desc nulls last`, asc(reviewRequests.id)]
        : [
            sql`${reviewRequests.dueAt} asc nulls last`,
            desc(reviewRequests.createdAt),
            asc(reviewRequests.id),
          ]),
    )
    .$dynamic()
  const rows = await (reviewed ? query.limit(REVIEWED_LIMIT) : query)

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
  const baselines = await loadBaselines(db, buildIds)
  const history = await loadHistory(
    db,
    rows.map((r) => ({ ...r.request, ...r.build, teamId: r.team.id })),
    reviewed,
  )

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
      closedAt: r.request.closedAt,
      decision: history.decisions.get(r.request.id) ?? null,
      reason: history.reasons.get(r.request.id) ?? null,
      baseline: baselines.get(r.request.buildId) ?? null,
      reviewer: r.reviewer,
      requestedBy: askerOf(r.request.requestedById, askers),
      build: r.build,
      team: { slug: r.team.slug, name: r.team.name },
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

/** The build each one was compared with. */
async function loadBaselines(db: Database, buildIds: string[]) {
  const result = new Map<string, { number: number; branch: string | null }>()
  if (buildIds.length === 0) return result
  const base = aliasedTable(builds, 'base')
  const rows = await db
    .select({ id: builds.id, number: base.number, branch: base.branch })
    .from(builds)
    .innerJoin(base, eq(base.id, builds.baseBuildId))
    .where(inArray(builds.id, buildIds))
  for (const r of rows) result.set(r.id, { number: r.number, branch: r.branch })
  return result
}

interface HistoryRow {
  id: string
  buildId: string
  reviewerId: string
  createdAt: Date
  teamId: string
  number: number
  branch: string | null
}

/**
 * What the reviewers' history says about each request: the reviewer's own decision on the build
 * (for closed requests), and why a request is not a first ask: they rejected an earlier build of
 * the branch, or they were asked about this build before and that request closed.
 */
async function loadHistory(db: Database, rows: HistoryRow[], withDecisions: boolean) {
  const decisions = new Map<string, 'approved' | 'rejected'>()
  const reasons = new Map<string, listReviewRequests.Reason>()
  if (rows.length === 0) return { decisions, reasons }
  const reviewerIds = [...new Set(rows.map((r) => r.reviewerId))]

  if (withDecisions) {
    const own = await db
      .select({ buildId: reviews.buildId, userId: reviews.userId, state: reviews.state })
      .from(reviews)
      .where(
        and(
          inArray(reviews.buildId, [...new Set(rows.map((r) => r.buildId))]),
          inArray(reviews.userId, reviewerIds),
        ),
      )
      .orderBy(asc(reviews.createdAt), asc(reviews.id))
    const latest = new Map(own.map((o) => [`${o.buildId}:${o.userId}`, o.state]))
    for (const r of rows) {
      const state = latest.get(`${r.buildId}:${r.reviewerId}`)
      if (state === 'approved' || state === 'rejected') decisions.set(r.id, state)
    }
  }

  // Earlier builds of the same branches where these reviewers decided.
  const branched = rows.filter((r) => r.branch !== null)
  if (branched.length > 0) {
    const earlier = await db
      .select({
        userId: reviews.userId,
        state: reviews.state,
        teamId: builds.teamId,
        branch: builds.branch,
        number: builds.number,
        createdAt: reviews.createdAt,
      })
      .from(reviews)
      .innerJoin(builds, eq(builds.id, reviews.buildId))
      .where(
        and(
          inArray(reviews.userId, reviewerIds),
          inArray(builds.teamId, [...new Set(branched.map((r) => r.teamId))]),
          inArray(builds.branch, [...new Set(branched.flatMap((r) => r.branch ?? []))]),
          lt(builds.number, Math.max(...branched.map((r) => r.number))),
        ),
      )
      .orderBy(asc(reviews.createdAt))
    for (const r of branched) {
      // The reviewer's most recent decision on an earlier build of this branch.
      const last = earlier.findLast(
        (e) =>
          e.userId === r.reviewerId &&
          e.teamId === r.teamId &&
          e.branch === r.branch &&
          e.number < r.number,
      )
      if (last?.state === 'rejected') {
        reasons.set(r.id, { kind: 'rejected_earlier', buildNumber: last.number })
      }
    }
  }

  // A request made again: the same reviewer had one on this build before, now closed.
  const before = await db
    .select({
      buildId: reviewRequests.buildId,
      reviewerId: reviewRequests.reviewerId,
      createdAt: reviewRequests.createdAt,
    })
    .from(reviewRequests)
    .where(
      and(
        inArray(reviewRequests.buildId, [...new Set(rows.map((r) => r.buildId))]),
        inArray(reviewRequests.reviewerId, reviewerIds),
        not(eq(reviewRequests.state, 'open')),
      ),
    )
  for (const r of rows) {
    if (reasons.has(r.id)) continue
    const again = before.some(
      (b) => b.buildId === r.buildId && b.reviewerId === r.reviewerId && b.createdAt < r.createdAt,
    )
    if (again) reasons.set(r.id, { kind: 're_requested' })
  }
  return { decisions, reasons }
}
