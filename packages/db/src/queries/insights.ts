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

import type { Database } from '../client.ts'
import { orgAccepts, type SessionMethod } from '../repositories/auth-settings.ts'
import {
  builds,
  files,
  member,
  organization,
  projects,
  reviewRequests,
  reviews,
  screenshotDiffs,
  screenshots,
  user,
} from '../schema/index.ts'

/**
 * Insights (PLAN M4 metrics): aggregates over an organization's review history, optionally for
 * one project. Everything is limited to organizations the user belongs to.
 *
 * Definitions:
 * - A build is *ready* when it finished (`completedAt`, else `createdAt`).
 * - A build is *reviewed* when a person (not an automatic approval) first decided on it; time to
 *   review is ready to that first decision, and the build belongs to the range its first
 *   decision falls in.
 * - Change rate is finished builds with changes over all finished builds, by ready time.
 * - A screenshot is flaky at a moment by the project's flaky rule (`flakyNames`) over its
 *   default-branch builds up to then.
 */

export interface InsightsSummary {
  medianReviewHours: number | null
  p90ReviewHours: number | null
  buildsReviewed: number
  reviewedOverTarget: number
  buildsFinished: number
  buildsWithChanges: number
  changeRate: number | null
}

export interface InsightsWeek {
  weekStart: Date
  medianReviewHours: number | null
  reviews: number
  flaky: number
}

export interface InsightsReviewer {
  id: string
  name: string
  openRequests: number
  overdue: number
  reviews: number
  medianResponseHours: number | null
}

export interface InsightsReport {
  org: { slug: string; name: string }
  project: string | null
  range: { from: Date; to: Date }
  summary: InsightsSummary
  previous: InsightsSummary
  weeks: InsightsWeek[]
  storage: { projects: { slug: string; name: string; bytes: number }[]; totalBytes: number }
  reviewers: InsightsReviewer[]
}

/**
 * The report for `[from, to)` and the stretch of equal length before it. Undefined when the
 * organization (or the narrowed project) isn't visible to `userId`.
 */
export async function getInsights(
  db: Database,
  input: {
    userId: string
    orgSlug: string
    projectSlug?: string
    from: Date
    to: Date
    now?: Date
    method?: SessionMethod
  },
): Promise<InsightsReport | undefined> {
  const [org] = await db
    .select({ id: organization.id, slug: organization.slug, name: organization.name })
    .from(organization)
    .innerJoin(
      member,
      and(eq(member.organizationId, organization.id), eq(member.userId, input.userId)),
    )
    .where(and(eq(organization.slug, input.orgSlug), orgAccepts(organization.id, input.method)))
  if (!org) return undefined

  const scoped = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      defaultBranch: projects.defaultBranch,
      reviewTargetHours: projects.reviewTargetHours,
    })
    .from(projects)
    .where(
      and(
        eq(projects.orgId, org.id),
        ...(input.projectSlug === undefined ? [] : [eq(projects.slug, input.projectSlug)]),
      ),
    )
    .orderBy(projects.slug)
  if (input.projectSlug !== undefined && scoped.length === 0) return undefined
  const projectIds = scoped.map((p) => p.id)

  const { from, to } = input
  const now = input.now ?? new Date()
  const span = to.getTime() - from.getTime()
  const previousFrom = new Date(from.getTime() - span)
  const targets = new Map(scoped.map((p) => [p.id, p.reviewTargetHours]))

  const empty = projectIds.length === 0
  const reviewed = empty ? [] : await firstReviews(db, projectIds, previousFrom, to)
  const finished = empty ? [] : await finishedBuilds(db, projectIds, previousFrom, to)

  const summarize = (lo: Date, hi: Date): InsightsSummary => {
    const inRange = reviewed.filter((r) => r.reviewedAt >= lo && r.reviewedAt < hi)
    const hours = inRange.map((r) => r.hours)
    const done = finished.filter((b) => b.readyAt >= lo && b.readyAt < hi)
    const withChanges = done.filter((b) => b.changed).length
    return {
      medianReviewHours: median(hours),
      p90ReviewHours: percentile(hours, 0.9),
      buildsReviewed: inRange.length,
      reviewedOverTarget: inRange.filter((r) => {
        const target = targets.get(r.projectId)
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
  const weeks = weeksBetween(from, to).map((start): InsightsWeek => {
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
    org: { slug: org.slug, name: org.name },
    project: input.projectSlug ?? null,
    range: { from, to },
    summary: summarize(from, to),
    previous: summarize(previousFrom, from),
    weeks,
    storage: await storageByProject(db, scoped),
    reviewers: await reviewerLoad(db, { orgId: org.id, projectIds, from, to, now }),
  }
}

/** Builds whose first human decision falls in `[from, to)`, with the wait before it. */
async function firstReviews(db: Database, projectIds: string[], from: Date, to: Date) {
  const readyAt = sql<Date>`coalesce(${builds.completedAt}, ${builds.createdAt})`
  const firstAt = min(reviews.createdAt)
  const rows = await db
    .select({ projectId: builds.projectId, readyAt, reviewedAt: firstAt })
    .from(reviews)
    .innerJoin(builds, eq(builds.id, reviews.buildId))
    .where(
      and(
        inArray(builds.projectId, projectIds),
        isNotNull(reviews.userId),
        ne(reviews.source, 'auto'),
      ),
    )
    .groupBy(builds.id)
    .having(and(gte(firstAt, from), lt(firstAt, to)))
  return rows.flatMap((r) => {
    if (!r.reviewedAt) return []
    const ready = new Date(r.readyAt)
    return [
      {
        projectId: r.projectId,
        reviewedAt: r.reviewedAt,
        hours: Math.max(0, r.reviewedAt.getTime() - ready.getTime()) / HOUR_MS,
      },
    ]
  })
}

async function finishedBuilds(db: Database, projectIds: string[], from: Date, to: Date) {
  const rows = await db
    .select({
      readyAt: sql<Date>`coalesce(${builds.completedAt}, ${builds.createdAt})`,
      conclusion: builds.conclusion,
    })
    .from(builds)
    .where(
      and(
        inArray(builds.projectId, projectIds),
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

/** Each project's finished default-branch builds up to `to`, oldest first, with what changed. */
async function defaultBranchHistory(
  db: Database,
  scoped: { id: string; defaultBranch: string }[],
  to: Date,
) {
  const rows = await db
    .select({
      projectId: builds.projectId,
      buildId: builds.id,
      createdAt: builds.createdAt,
      number: builds.number,
      branch: builds.branch,
    })
    .from(builds)
    .where(
      and(
        inArray(
          builds.projectId,
          scoped.map((p) => p.id),
        ),
        eq(builds.status, 'complete'),
        lt(builds.createdAt, to),
      ),
    )
    .orderBy(builds.createdAt, builds.number)
  const branchOf = new Map(scoped.map((p) => [p.id, p.defaultBranch]))
  const onDefault = rows.filter((r) => r.branch === branchOf.get(r.projectId))
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
  const byProject = new Map<string, HistoryBuild[]>()
  for (const r of onDefault) {
    const list = byProject.get(r.projectId) ?? []
    list.push({ createdAt: r.createdAt, changed: changed.get(r.buildId) ?? [] })
    byProject.set(r.projectId, list)
  }
  return byProject
}

/** Bytes of distinct files (screenshots, thumbnails and diffs) each project's builds refer to. */
async function storageByProject(
  db: Database,
  scoped: { id: string; slug: string; name: string }[],
): Promise<InsightsReport['storage']> {
  const ids = scoped.map((p) => p.id)
  const bytes = new Map<string, number>()
  if (ids.length > 0) {
    const refs = union(
      db
        .select({ projectId: builds.projectId, sha: screenshots.fileSha256 })
        .from(screenshots)
        .innerJoin(builds, eq(builds.id, screenshots.buildId))
        .where(inArray(builds.projectId, ids)),
      db
        .select({ projectId: builds.projectId, sha: sql<string>`${screenshots.thumbnailSha256}` })
        .from(screenshots)
        .innerJoin(builds, eq(builds.id, screenshots.buildId))
        .where(and(inArray(builds.projectId, ids), isNotNull(screenshots.thumbnailSha256))),
      db
        .select({
          projectId: builds.projectId,
          sha: sql<string>`${screenshotDiffs.diffFileSha256}`,
        })
        .from(screenshotDiffs)
        .innerJoin(builds, eq(builds.id, screenshotDiffs.buildId))
        .where(and(inArray(builds.projectId, ids), isNotNull(screenshotDiffs.diffFileSha256))),
    ).as('refs')
    const rows = await db
      .select({ projectId: refs.projectId, bytes: sum(files.size) })
      .from(refs)
      .innerJoin(files, eq(files.sha256, refs.sha))
      .groupBy(refs.projectId)
    for (const r of rows) bytes.set(r.projectId, Number(r.bytes ?? 0))
  }
  const list = scoped.map((p) => ({ slug: p.slug, name: p.name, bytes: bytes.get(p.id) ?? 0 }))
  return { projects: list, totalBytes: list.reduce((s, p) => s + p.bytes, 0) }
}

async function reviewerLoad(
  db: Database,
  input: { orgId: string; projectIds: string[]; from: Date; to: Date; now: Date },
): Promise<InsightsReviewer[]> {
  const members = await db
    .select({ id: user.id, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, input.orgId))
  const load = new Map<string, InsightsReviewer>(
    members.map((m) => [
      m.id,
      { ...m, openRequests: 0, overdue: 0, reviews: 0, medianResponseHours: null },
    ]),
  )
  if (input.projectIds.length > 0) {
    const decisions = await db
      .select({ userId: reviews.userId, n: count() })
      .from(reviews)
      .innerJoin(builds, eq(builds.id, reviews.buildId))
      .where(
        and(
          inArray(builds.projectId, input.projectIds),
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
      .where(inArray(builds.projectId, input.projectIds))
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
