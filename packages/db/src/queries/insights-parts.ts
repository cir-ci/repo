import { HOUR_MS, tallyFailures } from '@circi/core'
import { and, desc, eq, gte, inArray, isNotNull, lt, ne, or, sql } from 'drizzle-orm'

import {
  builds,
  ignoreRegions,
  reviews,
  screenshotDiffs,
  snapshotReviews,
  user,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * The loaders behind Insights that are not the headline numbers: what is waiting, which
 * screenshots change or get rejected, why builds fail, what ignore regions hid. Each takes the
 * ids of the projects the person may see, so a hidden project is never counted.
 */

export interface ProjectInfo {
  id: string
  slug: string
  name: string
  color: string
  icon: string | null
}

export interface ProjectRefOut {
  slug: string
  name: string
  colour: string
  icon: string | null
}

export const projectRef = (t: ProjectInfo): ProjectRefOut => ({
  slug: t.slug,
  name: t.name,
  colour: t.color,
  icon: t.icon,
})

const ready = sql`coalesce(${builds.completedAt}, ${builds.createdAt})`
const at = (d: Date) => sql`${d.toISOString()}::timestamptz`

export interface WaitCandidate {
  id: string
  projectId: string
  number: number
  branch: string | null
  author: string | null
  readyAt: Date
  pending: boolean
  /** The earliest decision of any kind (automatic ones too), whole build or single screenshot. */
  firstDecisionAt: Date | null
}

/**
 * Finished builds with changes that were waiting for a decision at some moment of `[from, to)`:
 * ready before `to`, and either decided after `from` or still pending.
 */
export async function waitCandidates(
  db: Database,
  projectIds: string[],
  from: Date,
  to: Date,
): Promise<WaitCandidate[]> {
  const decidedAfter = (table: typeof reviews | typeof snapshotReviews) =>
    db.select({ id: table.buildId }).from(table).where(gte(table.createdAt, from))
  const rows = await db
    .select({
      id: builds.id,
      projectId: builds.projectId,
      number: builds.number,
      branch: builds.branch,
      authorLogin: builds.authorLogin,
      authorName: user.name,
      readyAt: sql<Date>`${ready}`,
      reviewStatus: builds.reviewStatus,
    })
    .from(builds)
    .leftJoin(user, eq(user.id, builds.authorUserId))
    .where(
      and(
        inArray(builds.projectId, projectIds),
        eq(builds.status, 'complete'),
        eq(builds.conclusion, 'changes_detected'),
        sql`${ready} < ${at(to)}`,
        or(
          sql`${ready} >= ${at(from)}`,
          eq(builds.reviewStatus, 'pending'),
          inArray(builds.id, decidedAfter(reviews)),
          inArray(builds.id, decidedAfter(snapshotReviews)),
        ),
      ),
    )
  if (rows.length === 0) return []
  const first = new Map<string, Date>()
  const note = (buildId: string, when: Date | string | null) => {
    if (when === null) return
    const d = new Date(when)
    const seen = first.get(buildId)
    if (!seen || d < seen) first.set(buildId, d)
  }
  const idList = rows.map((r) => r.id)
  const wholeBuild = await db
    .select({ buildId: reviews.buildId, at: sql<Date>`min(${reviews.createdAt})` })
    .from(reviews)
    .where(inArray(reviews.buildId, idList))
    .groupBy(reviews.buildId)
  const perShot = await db
    .select({
      buildId: snapshotReviews.buildId,
      at: sql<Date>`min(${snapshotReviews.createdAt})`,
    })
    .from(snapshotReviews)
    .where(inArray(snapshotReviews.buildId, idList))
    .groupBy(snapshotReviews.buildId)
  for (const r of [...wholeBuild, ...perShot]) note(r.buildId, r.at)
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    number: r.number,
    branch: r.branch,
    author: r.authorName ?? r.authorLogin,
    readyAt: new Date(r.readyAt),
    pending: r.reviewStatus === 'pending',
    firstDecisionAt: first.get(r.id) ?? null,
  }))
}

/** Builds waiting at the end of each of `days` (the last one counts as of `now`). */
export function backlogByDay(
  candidates: readonly WaitCandidate[],
  days: readonly Date[],
  now: Date,
  dayMs: number,
): { day: Date; waiting: number }[] {
  return days.map((day) => {
    const end = Math.min(day.getTime() + dayMs, now.getTime())
    const live = end >= now.getTime()
    return {
      day,
      waiting: candidates.filter((c) => {
        if (c.readyAt.getTime() > end) return false
        if (live) return c.pending
        return c.firstDecisionAt === null || c.firstDecisionAt.getTime() > end
      }).length,
    }
  })
}

/** Builds that ended in `error` in `[from, to)`: their messages, for grouping. */
export function failureReasons(messages: readonly (string | null)[]) {
  return tallyFailures(messages, 5)
}

/** Screenshots that changed most among finished builds in `[from, to)`. */
export async function mostChangedScreenshots(
  db: Database,
  projectIds: string[],
  from: Date,
  to: Date,
  limit = 5,
) {
  const changed = sql<string>`count(*) filter (where ${screenshotDiffs.status} = 'changed')`
  const rows = await db
    .select({
      projectId: builds.projectId,
      name: screenshotDiffs.name,
      changed,
      total: sql<string>`count(*)`,
    })
    .from(screenshotDiffs)
    .innerJoin(builds, eq(builds.id, screenshotDiffs.buildId))
    .where(
      and(
        inArray(builds.projectId, projectIds),
        eq(builds.status, 'complete'),
        sql`${ready} >= ${at(from)}`,
        sql`${ready} < ${at(to)}`,
      ),
    )
    .groupBy(builds.projectId, screenshotDiffs.name)
    .having(sql`count(*) filter (where ${screenshotDiffs.status} = 'changed') > 0`)
    .orderBy(desc(changed), screenshotDiffs.name)
    .limit(limit)
  return rows.map((r) => ({
    projectId: r.projectId,
    name: r.name,
    changedBuilds: Number(r.changed),
    builds: Number(r.total),
  }))
}

/** Screenshots rejected most often by a person, counting every rejection event, even replaced ones. */
export async function mostRejectedScreenshots(
  db: Database,
  projectIds: string[],
  from: Date,
  to: Date,
  limit = 5,
) {
  const count = sql<string>`count(*)`
  const rows = await db
    .select({ projectId: builds.projectId, name: snapshotReviews.snapshotName, rejections: count })
    .from(snapshotReviews)
    .innerJoin(builds, eq(builds.id, snapshotReviews.buildId))
    .where(
      and(
        inArray(builds.projectId, projectIds),
        eq(snapshotReviews.decision, 'rejected'),
        gte(snapshotReviews.createdAt, from),
        lt(snapshotReviews.createdAt, to),
      ),
    )
    .groupBy(builds.projectId, snapshotReviews.snapshotName)
    .orderBy(desc(count), snapshotReviews.snapshotName)
    .limit(limit)
  return rows.map((r) => ({
    projectId: r.projectId,
    name: r.name,
    rejections: Number(r.rejections),
  }))
}

export interface RejectionEvent {
  buildId: string
  projectId: string
  number: number
  reviewer: string | null
  reason: string | null
  at: Date
}

/** Every rejection in `[from, to)`, whole-build and per-screenshot, newest first. */
export async function rejectionEvents(
  db: Database,
  projectIds: string[],
  from: Date,
  to: Date,
): Promise<RejectionEvent[]> {
  const whole = await db
    .select({
      buildId: builds.id,
      projectId: builds.projectId,
      number: builds.number,
      reviewer: user.name,
      reason: reviews.reason,
      at: reviews.createdAt,
    })
    .from(reviews)
    .innerJoin(builds, eq(builds.id, reviews.buildId))
    .leftJoin(user, eq(user.id, reviews.userId))
    .where(
      and(
        inArray(builds.projectId, projectIds),
        eq(reviews.state, 'rejected'),
        gte(reviews.createdAt, from),
        lt(reviews.createdAt, to),
      ),
    )
  const single = await db
    .select({
      buildId: builds.id,
      projectId: builds.projectId,
      number: builds.number,
      reviewer: user.name,
      reason: snapshotReviews.reason,
      at: snapshotReviews.createdAt,
    })
    .from(snapshotReviews)
    .innerJoin(builds, eq(builds.id, snapshotReviews.buildId))
    .leftJoin(user, eq(user.id, snapshotReviews.userId))
    .where(
      and(
        inArray(builds.projectId, projectIds),
        eq(snapshotReviews.decision, 'rejected'),
        gte(snapshotReviews.createdAt, from),
        lt(snapshotReviews.createdAt, to),
      ),
    )
  return [...whole, ...single].toSorted((a, b) => b.at.getTime() - a.at.getTime())
}

/** Diffs that were `unchanged` only because an ignore region hid pixels, with the regions. */
export async function suppressedDiffs(db: Database, projectIds: string[], from: Date, to: Date) {
  return db
    .select({ projectId: builds.projectId, regions: screenshotDiffs.ignoredRegions })
    .from(screenshotDiffs)
    .innerJoin(builds, eq(builds.id, screenshotDiffs.buildId))
    .where(
      and(
        inArray(builds.projectId, projectIds),
        eq(screenshotDiffs.status, 'unchanged'),
        sql`${screenshotDiffs.ignoredChangedPixels} > 0`,
        sql`${ready} >= ${at(from)}`,
        sql`${ready} < ${at(to)}`,
      ),
    )
}

/** Projects (of those given) that have at least one ignore region. */
export async function projectsWithIgnoreRegions(
  db: Database,
  projectIds: string[],
): Promise<number> {
  const rows = await db
    .selectDistinct({ projectId: ignoreRegions.projectId })
    .from(ignoreRegions)
    .where(inArray(ignoreRegions.projectId, projectIds))
  return rows.length
}

/** Builds in `[from, to)` whose person decisions exist (whole build or single screenshot). */
export async function personDecidedBuilds(
  db: Database,
  projectIds: string[],
  from: Date,
  to: Date,
): Promise<Set<string>> {
  const range = and(
    inArray(builds.projectId, projectIds),
    sql`${ready} >= ${at(from)}`,
    sql`${ready} < ${at(to)}`,
  )
  const whole = await db
    .selectDistinct({ id: reviews.buildId })
    .from(reviews)
    .innerJoin(builds, eq(builds.id, reviews.buildId))
    .where(and(range, isNotNull(reviews.userId), ne(reviews.source, 'auto')))
  const single = await db
    .selectDistinct({ id: snapshotReviews.buildId })
    .from(snapshotReviews)
    .innerJoin(builds, eq(builds.id, snapshotReviews.buildId))
    .where(and(range, isNotNull(snapshotReviews.userId), ne(snapshotReviews.source, 'auto')))
  return new Set([...whole, ...single].map((r) => r.id))
}

/**
 * Builds whose last decision by a person (approved or rejected) falls in `[from, to)`, with the
 * wait from ready to it. A build with no decision yet is not counted.
 */
export async function lastDecisions(db: Database, projectIds: string[], from: Date, to: Date) {
  const lastAt = sql<Date>`max(${reviews.createdAt}) filter (where ${reviews.userId} is not null and ${reviews.source} <> 'auto')`
  const rows = await db
    .select({ projectId: builds.projectId, readyAt: sql<Date>`${ready}`, decidedAt: lastAt })
    .from(reviews)
    .innerJoin(builds, eq(builds.id, reviews.buildId))
    .where(and(inArray(builds.projectId, projectIds), lt(reviews.createdAt, to)))
    .groupBy(builds.id)
    .having(sql`${lastAt} >= ${at(from)} and ${lastAt} < ${at(to)}`)
  return rows.flatMap((r) => {
    if (!r.decidedAt) return []
    const readyAt = new Date(r.readyAt)
    const decidedAt = new Date(r.decidedAt)
    return [
      {
        projectId: r.projectId,
        readyAt,
        decidedAt,
        hours: Math.max(0, decidedAt.getTime() - readyAt.getTime()) / HOUR_MS,
      },
    ]
  })
}
