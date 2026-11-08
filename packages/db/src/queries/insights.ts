import {
  flakyNames,
  HOUR_MS,
  isOverdue,
  isSnoozed,
  median,
  percentile,
  WEEK_MS,
  weeksBetween,
} from '@circi/core'
import { and, count, eq, gte, inArray, isNotNull, lt, min, ne, sql, sum } from 'drizzle-orm'
import { union } from 'drizzle-orm/pg-core'

import { workspaceAccepts, type SessionMethod } from '#repositories/auth-settings.ts'
import {
  builds,
  files,
  member,
  workspace,
  teams,
  reviewRequests,
  reviews,
  screenshotDiffs,
  screenshots,
  user,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * Insights (PLAN M4 metrics): aggregates over a workspace's review history, optionally for
 * one team. Everything is limited to workspaces the user belongs to.
 *
 * Definitions:
 * - A build is *ready* when it finished (`completedAt`, else `createdAt`).
 * - A build is *reviewed* when a person (not an automatic approval) first decided on it; time to
 *   review is ready to that first decision, and the build belongs to the range its first
 *   decision falls in.
 * - Change rate is finished builds with changes over all finished builds, by ready time.
 * - A screenshot is flaky at a moment by the team's flaky rule (`flakyNames`) over its
 *   default-branch builds up to then.
 */

export namespace getInsights {
  export interface Summary {
    medianReviewHours: number | null
    p90ReviewHours: number | null
    buildsReviewed: number
    reviewedOverTarget: number
    buildsFinished: number
    buildsWithChanges: number
    changeRate: number | null
  }

  export interface Week {
    weekStart: Date
    medianReviewHours: number | null
    reviews: number
    flaky: number
  }

  export interface Reviewer {
    id: string
    name: string
    openRequests: number
    overdue: number
    reviews: number
    medianResponseHours: number | null
  }

  export interface Report {
    workspace: { slug: string; name: string }
    team: string | null
    range: { from: Date; to: Date }
    summary: getInsights.Summary
    previous: getInsights.Summary
    weeks: getInsights.Week[]
    storage: { teams: { slug: string; name: string; bytes: number }[]; totalBytes: number }
    reviewers: getInsights.Reviewer[]
  }
}

/**
 * The report for `[from, to)` and the stretch of equal length before it. Undefined when the
 * workspace (or the narrowed team) isn't visible to `userId`.
 */
export async function getInsights(
  db: Database,
  input: {
    userId: string
    workspaceSlug: string
    teamSlug?: string
    from: Date
    to: Date
    now?: Date
    method?: SessionMethod
  },
): Promise<getInsights.Report | undefined> {
  const [found] = await db
    .select({ id: workspace.id, slug: workspace.slug, name: workspace.name })
    .from(workspace)
    .innerJoin(member, and(eq(member.workspaceId, workspace.id), eq(member.userId, input.userId)))
    .where(
      and(eq(workspace.slug, input.workspaceSlug), workspaceAccepts(workspace.id, input.method)),
    )
  if (!found) return undefined

  const scoped = await db
    .select({
      id: teams.id,
      slug: teams.slug,
      name: teams.name,
      defaultBranch: teams.defaultBranch,
      reviewTargetHours: teams.reviewTargetHours,
    })
    .from(teams)
    .where(
      and(
        eq(teams.workspaceId, found.id),
        ...(input.teamSlug === undefined ? [] : [eq(teams.slug, input.teamSlug)]),
      ),
    )
    .orderBy(teams.slug)
  if (input.teamSlug !== undefined && scoped.length === 0) return undefined
  const teamIds = scoped.map((p) => p.id)

  const { from, to } = input
  const now = input.now ?? new Date()
  const span = to.getTime() - from.getTime()
  const previousFrom = new Date(from.getTime() - span)
  const targets = new Map(scoped.map((p) => [p.id, p.reviewTargetHours]))

  const empty = teamIds.length === 0
  const reviewed = empty ? [] : await firstReviews(db, teamIds, previousFrom, to)
  const finished = empty ? [] : await finishedBuilds(db, teamIds, previousFrom, to)

  const summarize = (lo: Date, hi: Date): getInsights.Summary => {
    const inRange = reviewed.filter((r) => r.reviewedAt >= lo && r.reviewedAt < hi)
    const hours = inRange.map((r) => r.hours)
    const done = finished.filter((b) => b.readyAt >= lo && b.readyAt < hi)
    const withChanges = done.filter((b) => b.changed).length
    return {
      medianReviewHours: median(hours),
      p90ReviewHours: percentile(hours, 0.9),
      buildsReviewed: inRange.length,
      reviewedOverTarget: inRange.filter((r) => {
        const target = targets.get(r.teamId)
        return target !== null && target !== undefined && r.hours > target
      }).length,
      buildsFinished: done.length,
      buildsWithChanges: withChanges,
      changeRate: done.length === 0 ? null : withChanges / done.length,
    }
  }

  const history = empty
    ? new Map<string, HistoryBuild[]>()
    : await defaultBranchHistory(db, scoped, to)
  const weeks = weeksBetween(from, to).map((start): getInsights.Week => {
    const end = new Date(Math.min(start.getTime() + WEEK_MS, to.getTime()))
    const lo = new Date(Math.max(start.getTime(), from.getTime()))
    const inWeek = reviewed.filter((r) => r.reviewedAt >= lo && r.reviewedAt < end)
    let flaky = 0
    for (const p of scoped) {
      const upTo = (history.get(p.id) ?? []).filter((b) => b.createdAt <= end)
      flaky += flakyNames(upTo).length
    }
    return {
      weekStart: start,
      medianReviewHours: median(inWeek.map((r) => r.hours)),
      reviews: inWeek.length,
      flaky,
    }
  })

  return {
    workspace: { slug: found.slug, name: found.name },
    team: input.teamSlug ?? null,
    range: { from, to },
    summary: summarize(from, to),
    previous: summarize(previousFrom, from),
    weeks,
    storage: await storageByTeam(db, scoped),
    reviewers: await reviewerLoad(db, { workspaceId: found.id, teamIds, from, to, now }),
  }
}

/** Builds whose first human decision falls in `[from, to)`, with the wait before it. */
async function firstReviews(db: Database, teamIds: string[], from: Date, to: Date) {
  const readyAt = sql<Date>`coalesce(${builds.completedAt}, ${builds.createdAt})`
  const firstAt = min(reviews.createdAt)
  const rows = await db
    .select({ teamId: builds.teamId, readyAt, reviewedAt: firstAt })
    .from(reviews)
    .innerJoin(builds, eq(builds.id, reviews.buildId))
    .where(
      and(inArray(builds.teamId, teamIds), isNotNull(reviews.userId), ne(reviews.source, 'auto')),
    )
    .groupBy(builds.id)
    .having(and(gte(firstAt, from), lt(firstAt, to)))
  return rows.flatMap((r) => {
    if (!r.reviewedAt) return []
    const ready = new Date(r.readyAt)
    return [
      {
        teamId: r.teamId,
        reviewedAt: r.reviewedAt,
        hours: Math.max(0, r.reviewedAt.getTime() - ready.getTime()) / HOUR_MS,
      },
    ]
  })
}

async function finishedBuilds(db: Database, teamIds: string[], from: Date, to: Date) {
  const rows = await db
    .select({
      readyAt: sql<Date>`coalesce(${builds.completedAt}, ${builds.createdAt})`,
      conclusion: builds.conclusion,
    })
    .from(builds)
    .where(
      and(
        inArray(builds.teamId, teamIds),
        eq(builds.status, 'complete'),
        sql`coalesce(${builds.completedAt}, ${builds.createdAt}) >= ${from.toISOString()}::timestamptz`,
        sql`coalesce(${builds.completedAt}, ${builds.createdAt}) < ${to.toISOString()}::timestamptz`,
      ),
    )
  return rows.map((r) => ({
    readyAt: new Date(r.readyAt),
    changed: r.conclusion === 'changes_detected',
  }))
}

interface HistoryBuild {
  createdAt: Date
  changed: string[]
}

/** Each team's finished default-branch builds up to `to`, oldest first, with what changed. */
async function defaultBranchHistory(
  db: Database,
  scoped: { id: string; defaultBranch: string }[],
  to: Date,
) {
  const rows = await db
    .select({
      teamId: builds.teamId,
      buildId: builds.id,
      createdAt: builds.createdAt,
      number: builds.number,
      branch: builds.branch,
    })
    .from(builds)
    .where(
      and(
        inArray(
          builds.teamId,
          scoped.map((p) => p.id),
        ),
        eq(builds.status, 'complete'),
        lt(builds.createdAt, to),
      ),
    )
    .orderBy(builds.createdAt, builds.number)
  const branchOf = new Map(scoped.map((p) => [p.id, p.defaultBranch]))
  const onDefault = rows.filter((r) => r.branch === branchOf.get(r.teamId))
  const changed = new Map<string, string[]>()
  if (onDefault.length > 0) {
    const diffs = await db
      .select({ buildId: screenshotDiffs.buildId, name: screenshotDiffs.name })
      .from(screenshotDiffs)
      .where(
        and(
          eq(screenshotDiffs.status, 'changed'),
          inArray(
            screenshotDiffs.buildId,
            onDefault.map((r) => r.buildId),
          ),
        ),
      )
    for (const d of diffs) changed.set(d.buildId, [...(changed.get(d.buildId) ?? []), d.name])
  }
  const byTeam = new Map<string, HistoryBuild[]>()
  for (const r of onDefault) {
    const list = byTeam.get(r.teamId) ?? []
    list.push({ createdAt: r.createdAt, changed: changed.get(r.buildId) ?? [] })
    byTeam.set(r.teamId, list)
  }
  return byTeam
}

/** Bytes of distinct files (screenshots, thumbnails and diffs) each team's builds refer to. */
async function storageByTeam(
  db: Database,
  scoped: { id: string; slug: string; name: string }[],
): Promise<getInsights.Report['storage']> {
  const ids = scoped.map((p) => p.id)
  const bytes = new Map<string, number>()
  if (ids.length > 0) {
    const refs = union(
      db
        .select({ teamId: builds.teamId, sha: screenshots.fileSha256 })
        .from(screenshots)
        .innerJoin(builds, eq(builds.id, screenshots.buildId))
        .where(inArray(builds.teamId, ids)),
      db
        .select({ teamId: builds.teamId, sha: sql<string>`${screenshots.thumbnailSha256}` })
        .from(screenshots)
        .innerJoin(builds, eq(builds.id, screenshots.buildId))
        .where(and(inArray(builds.teamId, ids), isNotNull(screenshots.thumbnailSha256))),
      db
        .select({
          teamId: builds.teamId,
          sha: sql<string>`${screenshotDiffs.diffFileSha256}`,
        })
        .from(screenshotDiffs)
        .innerJoin(builds, eq(builds.id, screenshotDiffs.buildId))
        .where(and(inArray(builds.teamId, ids), isNotNull(screenshotDiffs.diffFileSha256))),
    ).as('refs')
    const rows = await db
      .select({ teamId: refs.teamId, bytes: sum(files.size) })
      .from(refs)
      .innerJoin(files, eq(files.sha256, refs.sha))
      .groupBy(refs.teamId)
    for (const r of rows) bytes.set(r.teamId, Number(r.bytes ?? 0))
  }
  const list = scoped.map((p) => ({ slug: p.slug, name: p.name, bytes: bytes.get(p.id) ?? 0 }))
  return { teams: list, totalBytes: list.reduce((s, p) => s + p.bytes, 0) }
}

async function reviewerLoad(
  db: Database,
  input: { workspaceId: string; teamIds: string[]; from: Date; to: Date; now: Date },
): Promise<getInsights.Reviewer[]> {
  const members = await db
    .select({ id: user.id, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.workspaceId, input.workspaceId))
  const load = new Map<string, getInsights.Reviewer>(
    members.map((m) => [
      m.id,
      { ...m, openRequests: 0, overdue: 0, reviews: 0, medianResponseHours: null },
    ]),
  )
  if (input.teamIds.length > 0) {
    const decisions = await db
      .select({ userId: reviews.userId, n: count() })
      .from(reviews)
      .innerJoin(builds, eq(builds.id, reviews.buildId))
      .where(
        and(
          inArray(builds.teamId, input.teamIds),
          isNotNull(reviews.userId),
          ne(reviews.source, 'auto'),
          gte(reviews.createdAt, input.from),
          lt(reviews.createdAt, input.to),
        ),
      )
      .groupBy(reviews.userId)
    for (const d of decisions) {
      const row = d.userId ? load.get(d.userId) : undefined
      if (row) row.reviews = d.n
    }

    const requests = await db
      .select({
        reviewerId: reviewRequests.reviewerId,
        state: reviewRequests.state,
        createdAt: reviewRequests.createdAt,
        closedAt: reviewRequests.closedAt,
        dueAt: reviewRequests.dueAt,
        snoozedUntil: reviewRequests.snoozedUntil,
        snoozeKind: reviewRequests.snoozeKind,
      })
      .from(reviewRequests)
      .innerJoin(builds, eq(builds.id, reviewRequests.buildId))
      .where(inArray(builds.teamId, input.teamIds))
    const responses = new Map<string, number[]>()
    for (const r of requests) {
      const row = load.get(r.reviewerId)
      if (!row) continue
      if (r.state === 'open') {
        row.openRequests += 1
        if (isOverdue(r.dueAt, input.now, isSnoozed(r, input.now))) row.overdue += 1
      } else if (
        r.state === 'done' &&
        r.closedAt &&
        r.closedAt >= input.from &&
        r.closedAt < input.to
      ) {
        responses.set(r.reviewerId, [
          ...(responses.get(r.reviewerId) ?? []),
          (r.closedAt.getTime() - r.createdAt.getTime()) / HOUR_MS,
        ])
        if (r.dueAt && r.closedAt > r.dueAt) row.overdue += 1
      }
    }
    for (const [id, hours] of responses) {
      const row = load.get(id)
      if (row) row.medianResponseHours = median(hours)
    }
  }
  return load
    .values()
    .toArray()
    .toSorted(
      (a, b) => b.reviews - a.reviews || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    )
}
