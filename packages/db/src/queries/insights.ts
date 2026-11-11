import {
  bucketsBetween,
  DAY_MS,
  FLAKY_WINDOW,
  flakyScreenshots,
  lastCommits,
  HOUR_MS,
  isOverdue,
  isSnoozed,
  median,
  percentile,
  reviewDueAt,
  WEEK_MS,
  type FlakyReason,
} from '@circi/core'
import { and, eq, gte, inArray, isNotNull, lt, min, ne, sql, sum } from 'drizzle-orm'
import { union } from 'drizzle-orm/pg-core'

import {
  builds,
  files,
  member,
  workspace,
  projects,
  reviewRequests,
  reviews,
  screenshotDiffs,
  screenshots,
  snapshotReviews,
  user,
} from '#schema/index.ts'
import { projectVisibleTo } from '#shared/project-visibility.ts'
import { workspaceAccepts, type SessionMethod } from '#shared/session-method.ts'
import type { Database } from '#src/client.ts'

import { FLAKY_HISTORY_MAX_BUILDS, loadFlakyHistory, type FlakyHistoryBuild } from './flaky.ts'
import {
  backlogByDay,
  failureReasons,
  lastDecisions,
  mostChangedScreenshots,
  mostRejectedScreenshots,
  personDecidedBuilds,
  rejectionEvents,
  suppressedDiffs,
  projectRef,
  projectsWithIgnoreRegions,
  waitCandidates,
} from './insights-parts.ts'

/**
 * Insights (PLAN M4 metrics): aggregates over a workspace's review history, optionally for
 * one project. Everything is limited to workspaces the user belongs to and the projects they can see.
 *
 * Definitions:
 * - A build is *ready* when it finished (`completedAt`, else `createdAt`).
 * - A build is *reviewed* when a person (not an automatic approval) first decided on it; time to
 *   review is ready to that first decision, and the build belongs to the range its first
 *   decision falls in. *Decided* is the same with the last decision (the build's approval or
 *   rejection), for whole-build decisions.
 * - Change rate is finished builds with changes over all finished builds, by ready time.
 * - A screenshot is flaky at a moment by the project's flaky rule (`flakyScreenshots`) over its
 *   default-branch history up to then, loaded by the same bounded query as every other flaky answer
 *   (`loadFlakyHistory`). Insights has no flaky definition of its own: the Flaky screenshots chart, the
 *   Flakiest list (flip-flops, and a strip of which of the last 10 commits changed the image from the
 *   one before) and the Projects comparison's Flaky now all read that one verdict.
 * - A build's outcome (one per finished build, by ready time): failed (`error`), else rejected,
 *   else approved by a person, else auto-approved; a build still waiting has none yet.
 */

/**
 * Which of a project's last 10 default-branch commits changed a screenshot's image from the commit
 * before it (oldest first). A commit with several runs counts by its last image; a commit
 * without the screenshot is skipped, so a removal is not a change. The first commit ever seen
 * has nothing before it. Not the diff status: this is the rule's own view of change.
 */
function changeStrip(history: readonly FlakyHistoryBuild[], name: string): boolean[] {
  let previous: string | null = null
  const strip: boolean[] = []
  for (const commit of lastCommits(history, FLAKY_WINDOW + 1)) {
    const image = commit.runs.flatMap((r) => r.shots.get(name)?.fileSha256 ?? []).at(-1)
    strip.push(previous !== null && image !== undefined && image !== previous)
    if (image !== undefined) previous = image
  }
  return strip.slice(-FLAKY_WINDOW)
}

export namespace getInsights {
  export interface Summary {
    medianReviewHours: number | null
    p90ReviewHours: number | null
    buildsReviewed: number
    reviewedOverTarget: number
    reviewedWithTarget: number
    buildsFinished: number
    buildsWithChanges: number
    changeRate: number | null
    medianDecisionHours: number | null
    p90DecisionHours: number | null
    buildsDecided: number
    failedBuilds: number
  }

  export interface ProjectRef {
    slug: string
    name: string
    colour: string
    icon: string | null
  }

  export interface Outcomes {
    approved: number
    autoApproved: number
    rejected: number
    failed: number
  }

  export interface Week {
    weekStart: Date
    medianReviewHours: number | null
    reviews: number
    flaky: number
    medianDecisionHours: number | null
    p90DecisionHours: number | null
    decided: number
    outcomes: Outcomes
    failedBuilds: number
    medianProcessingMinutes: number | null
    p90ProcessingMinutes: number | null
  }

  export interface Reviewer {
    id: string
    name: string
    image: string | null
    openRequests: number
    overdue: number
    reviews: number
    medianResponseHours: number | null
  }

  export interface ScreenshotChange {
    project: ProjectRef
    name: string
    changedBuilds: number
    builds: number
    last10: boolean[]
  }

  export interface FlakyScreenshot {
    project: ProjectRef
    name: string
    /** Times a commit's image came back to one it already had in the last 10 commits. */
    flipFlops: number
    /** Why it is flaky, with the evidence. */
    reason: FlakyReason
    last10: boolean[]
  }

  export interface Report {
    workspace: { slug: string; name: string }
    project: string | null
    range: { from: Date; to: Date }
    summary: getInsights.Summary
    previous: getInsights.Summary
    /** `day` for ranges of 7 days or less, else `week`. */
    bucket: 'day' | 'week'
    weeks: getInsights.Week[]
    storage: {
      projects: { slug: string; name: string; colour: string; icon: string | null; bytes: number }[]
      totalBytes: number
    }
    reviewers: getInsights.Reviewer[]
    /** The review target the scope shares, in hours; null when there is none or projects differ. */
    reviewTargetHours: number | null
    /** Days of branch builds retention keeps: the shortest and longest of the scope's projects. */
    retentionDays: { min: number; max: number } | null
    /** Changes before a screenshot is flaky, when every project in the scope agrees; else null. */
    flakyAfterChanges: number | null
    /** Builds waiting for a decision at the end of each day of the range. */
    backlog: { day: Date; waiting: number }[]
    waitingNow: number
    oldestWaiting: {
      buildId: string
      number: number
      project: ProjectRef
      branch: string | null
      author: string | null
      readyAt: Date
      overTarget: boolean
    }[]
    mostChanged: getInsights.ScreenshotChange[]
    flakiest: getInsights.FlakyScreenshot[]
    rejections: {
      rejectedBuilds: number
      withReason: number
      recent: {
        buildId: string
        number: number
        project: ProjectRef
        reviewer: string | null
        reason: string
        at: Date
      }[]
    }
    mostRejected: { project: ProjectRef; name: string; rejections: number }[]
    projectsComparison: {
      project: ProjectRef
      builds: number
      buildsWithChanges: number
      medianReviewHours: number | null
      reviewTargetHours: number | null
      flaky: number
      failed: number
    }[]
    failureReasons: { message: string; builds: number }[]
    /** Null when no project in view has an ignore region. */
    ignoreRegions: {
      suppressedDiffs: number
      top: { project: ProjectRef; region: string; diffs: number }[]
    } | null
  }
}

/**
 * The report for `[from, to)` and the stretch of equal length before it. Undefined when the
 * workspace (or the narrowed project) isn't visible to `userId`.
 */
export async function getInsights(
  db: Database,
  input: {
    userId: string
    workspaceSlug: string
    projectSlug?: string
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
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      color: projects.color,
      icon: projects.icon,
      defaultBranch: projects.defaultBranch,
      reviewTargetHours: projects.reviewTargetHours,
      retentionDays: projects.retentionDays,
      flakyAfterChanges: projects.flakyAfterChanges,
    })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, found.id),
        projectVisibleTo(input.userId, projects),
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
  const refs = new Map(scoped.map((p) => [p.id, projectRef(p)]))
  const refOf = (id: string): getInsights.ProjectRef => refs.get(id) ?? projectRef(scoped[0]!)
  const bucket = span <= 7 * DAY_MS ? 'day' : 'week'
  const step = bucket === 'day' ? DAY_MS : WEEK_MS

  const empty = projectIds.length === 0
  const [reviewed, decided, finished, personDecided, waits] = empty
    ? [[], [], [], new Set<string>(), []]
    : await Promise.all([
        firstReviews(db, projectIds, previousFrom, to),
        lastDecisions(db, projectIds, previousFrom, to),
        finishedBuilds(db, projectIds, previousFrom, to),
        personDecidedBuilds(db, projectIds, previousFrom, to),
        waitCandidates(db, projectIds, from, to),
      ])

  const summarize = (lo: Date, hi: Date): getInsights.Summary => {
    const inRange = reviewed.filter((r) => r.reviewedAt >= lo && r.reviewedAt < hi)
    const hours = inRange.map((r) => r.hours)
    const decidedHours = decided
      .filter((d) => d.decidedAt >= lo && d.decidedAt < hi)
      .map((d) => d.hours)
    const inWindow = finished.filter((b) => b.readyAt >= lo && b.readyAt < hi)
    const done = inWindow.filter((b) => b.status === 'complete')
    const withChanges = done.filter((b) => b.changed).length
    return {
      medianReviewHours: median(hours),
      p90ReviewHours: percentile(hours, 0.9),
      buildsReviewed: inRange.length,
      reviewedOverTarget: inRange.filter((r) => {
        const target = targets.get(r.projectId)
        // Counting working days, like the request's own due time.
        const due = reviewDueAt(r.readyAt, target ?? null)
        return due !== null && r.reviewedAt.getTime() > due.getTime()
      }).length,
      reviewedWithTarget: inRange.filter(
        (r) => targets.get(r.projectId) !== null && targets.get(r.projectId) !== undefined,
      ).length,
      buildsFinished: done.length,
      buildsWithChanges: withChanges,
      changeRate: done.length === 0 ? null : withChanges / done.length,
      medianDecisionHours: median(decidedHours),
      p90DecisionHours: percentile(decidedHours, 0.9),
      buildsDecided: decidedHours.length,
      failedBuilds: inWindow.length - done.length,
    }
  }

  const history = empty
    ? new Map<string, FlakyHistoryBuild[]>()
    : await loadFlakyHistory(db, scoped, { until: to, since: from })
  const weeks = bucketsBetween(from, to, bucket).map((start): getInsights.Week => {
    const end = new Date(Math.min(start.getTime() + step, to.getTime()))
    const lo = new Date(Math.max(start.getTime(), from.getTime()))
    const inWeek = reviewed.filter((r) => r.reviewedAt >= lo && r.reviewedAt < end)
    const decidedHours = decided
      .filter((d) => d.decidedAt >= lo && d.decidedAt < end)
      .map((d) => d.hours)
    const builtInWeek = finished.filter((b) => b.readyAt >= lo && b.readyAt < end)
    const outcomes = { approved: 0, autoApproved: 0, rejected: 0, failed: 0 }
    for (const b of builtInWeek) {
      const outcome = outcomeOf(b, personDecided.has(b.id))
      if (outcome) outcomes[outcome] += 1
    }
    const minutes = builtInWeek.flatMap((b) =>
      b.status === 'complete' && b.completedAt
        ? [Math.max(0, b.completedAt.getTime() - (b.finalizedAt ?? b.createdAt).getTime()) / 60_000]
        : [],
    )
    let flaky = 0
    for (const p of scoped) {
      const upTo = (history.get(p.id) ?? [])
        .filter((b) => b.createdAt <= end)
        .slice(-FLAKY_HISTORY_MAX_BUILDS)
      flaky += flakyScreenshots(upTo, { threshold: p.flakyAfterChanges }).length
    }
    return {
      weekStart: start,
      medianReviewHours: median(inWeek.map((r) => r.hours)),
      reviews: inWeek.length,
      flaky,
      medianDecisionHours: median(decidedHours),
      p90DecisionHours: percentile(decidedHours, 0.9),
      decided: decidedHours.length,
      outcomes,
      failedBuilds: outcomes.failed,
      medianProcessingMinutes: median(minutes),
      p90ProcessingMinutes: percentile(minutes, 0.9),
    }
  })

  const summary = summarize(from, to)
  const inRangeFinished = finished.filter((b) => b.readyAt >= from && b.readyAt < to)
  const waiting = waits
    .filter((w) => w.pending)
    .toSorted((a, b) => a.readyAt.getTime() - b.readyAt.getTime())

  const [mostChanged, mostRejected, rejected, suppressed, regionProjects] = empty
    ? [[], [], [], [], 0]
    : await Promise.all([
        mostChangedScreenshots(db, projectIds, from, to),
        mostRejectedScreenshots(db, projectIds, from, to),
        rejectionEvents(db, projectIds, from, to),
        suppressedDiffs(db, projectIds, from, to),
        projectsWithIgnoreRegions(db, projectIds),
      ])

  // The project's flaky screenshots now: the shared rule over the history up to the end of the range.
  const flakyNow = new Map(
    scoped.map((p) => [
      p.id,
      flakyScreenshots((history.get(p.id) ?? []).slice(-FLAKY_HISTORY_MAX_BUILDS), {
        threshold: p.flakyAfterChanges,
      }),
    ]),
  )

  const flakiest = scoped
    .flatMap((p) =>
      (flakyNow.get(p.id) ?? []).map((v) => {
        const strip = changeStrip(history.get(p.id) ?? [], v.name)
        return {
          project: refOf(p.id),
          name: v.name,
          flipFlops: v.flipFlops,
          reason: v.why,
          last10: strip,
        }
      }),
    )
    .toSorted(
      (a, b) =>
        b.flipFlops - a.flipFlops ||
        b.last10.filter(Boolean).length - a.last10.filter(Boolean).length ||
        a.project.name.localeCompare(b.project.name) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 5)

  const recent = new Map<string, (typeof rejected)[number]>()
  for (const e of rejected) {
    if (e.reason === null || e.reason.trim() === '') continue
    if (!recent.has(e.buildId)) recent.set(e.buildId, e)
  }
  const rejectedBuildIds = new Set(rejected.map((e) => e.buildId))

  const regionCounts = new Map<string, { projectId: string; region: string; diffs: number }>()
  for (const d of suppressed) {
    for (const region of new Set(d.regions)) {
      const key = `${d.projectId}\u0000${region}`
      const row = regionCounts.get(key) ?? { projectId: d.projectId, region, diffs: 0 }
      row.diffs += 1
      regionCounts.set(key, row)
    }
  }

  const projectsComparison =
    input.projectSlug === undefined
      ? scoped
          .map((p) => {
            const own = inRangeFinished.filter((b) => b.projectId === p.id)
            const done = own.filter((b) => b.status === 'complete')
            return {
              project: refOf(p.id),
              builds: done.length,
              buildsWithChanges: done.filter((b) => b.changed).length,
              medianReviewHours: median(
                reviewed
                  .filter((r) => r.projectId === p.id && r.reviewedAt >= from && r.reviewedAt < to)
                  .map((r) => r.hours),
              ),
              reviewTargetHours: p.reviewTargetHours,
              flaky: flakyNow.get(p.id)?.length ?? 0,
              failed: own.length - done.length,
            }
          })
          .toSorted((a, b) => b.builds - a.builds || a.project.name.localeCompare(b.project.name))
      : []

  return {
    workspace: { slug: found.slug, name: found.name },
    project: input.projectSlug ?? null,
    range: { from, to },
    summary,
    previous: summarize(previousFrom, from),
    bucket,
    weeks,
    storage: await storageByProject(db, scoped),
    reviewers: await reviewerLoad(db, { workspaceId: found.id, projectIds, from, to, now }),
    reviewTargetHours: shared(scoped.map((p) => p.reviewTargetHours)),
    retentionDays:
      scoped.length === 0
        ? null
        : {
            min: Math.min(...scoped.map((p) => p.retentionDays)),
            max: Math.max(...scoped.map((p) => p.retentionDays)),
          },
    flakyAfterChanges: shared(scoped.map((p) => p.flakyAfterChanges)),
    backlog: backlogByDay(
      waits,
      bucketsBetween(from, to, 'day').filter((d) => d.getTime() <= now.getTime()),
      now,
      DAY_MS,
    ).map((d) => ({
      day: d.day,
      waiting: d.waiting,
    })),
    waitingNow: waiting.length,
    oldestWaiting: waiting.slice(0, 5).map((w) => {
      const due = reviewDueAt(w.readyAt, targets.get(w.projectId) ?? null)
      return {
        buildId: w.id,
        number: w.number,
        project: refOf(w.projectId),
        branch: w.branch,
        author: w.author,
        readyAt: w.readyAt,
        overTarget: due !== null && now.getTime() > due.getTime(),
      }
    }),
    mostChanged: mostChanged.map((c) => ({
      project: refOf(c.projectId),
      name: c.name,
      changedBuilds: c.changedBuilds,
      builds: c.builds,
      last10: changeStrip(history.get(c.projectId) ?? [], c.name),
    })),
    flakiest,
    rejections: {
      rejectedBuilds: rejectedBuildIds.size,
      withReason: new Set(
        rejected.filter((e) => e.reason !== null && e.reason.trim() !== '').map((e) => e.buildId),
      ).size,
      recent: [...recent.values()].slice(0, 4).map((e) => ({
        buildId: e.buildId,
        number: e.number,
        project: refOf(e.projectId),
        reviewer: e.reviewer,
        reason: e.reason?.trim() ?? '',
        at: e.at,
      })),
    },
    mostRejected: mostRejected.map((r) => ({
      project: refOf(r.projectId),
      name: r.name,
      rejections: r.rejections,
    })),
    projectsComparison,
    failureReasons: failureReasons(
      inRangeFinished.filter((b) => b.status === 'error').map((b) => b.errorMessage),
    ),
    ignoreRegions:
      regionProjects === 0
        ? null
        : {
            suppressedDiffs: suppressed.length,
            top: regionCounts
              .values()
              .toArray()
              .toSorted((a, b) => b.diffs - a.diffs || a.region.localeCompare(b.region))
              .slice(0, 4)
              .map((r) => ({ project: refOf(r.projectId), region: r.region, diffs: r.diffs })),
          },
  }
}

/** One outcome per finished build; null while it still waits for a decision. */
function outcomeOf(
  b: { status: string; reviewStatus: string },
  decidedByPerson: boolean,
): keyof getInsights.Outcomes | null {
  if (b.status === 'error') return 'failed'
  if (b.reviewStatus === 'rejected') return 'rejected'
  if (b.reviewStatus !== 'approved') return null
  return decidedByPerson ? 'approved' : 'autoApproved'
}
/** The one value every project has, or null when there are none or they differ. */
function shared(values: (number | null)[]): number | null {
  const first = values[0]
  return first !== undefined && values.every((v) => v === first) ? first : null
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
        readyAt: ready,
        reviewedAt: r.reviewedAt,
        hours: Math.max(0, r.reviewedAt.getTime() - ready.getTime()) / HOUR_MS,
      },
    ]
  })
}

/** Builds that finished (or failed) with their ready time in `[from, to)`. */
async function finishedBuilds(db: Database, projectIds: string[], from: Date, to: Date) {
  const readyAt = sql<Date>`coalesce(${builds.completedAt}, ${builds.createdAt})`
  const rows = await db
    .select({
      id: builds.id,
      projectId: builds.projectId,
      status: builds.status,
      conclusion: builds.conclusion,
      reviewStatus: builds.reviewStatus,
      errorMessage: builds.errorMessage,
      createdAt: builds.createdAt,
      finalizedAt: builds.finalizedAt,
      completedAt: builds.completedAt,
      readyAt,
    })
    .from(builds)
    .where(
      and(
        inArray(builds.projectId, projectIds),
        inArray(builds.status, ['complete', 'error']),
        sql`${readyAt} >= ${from.toISOString()}::timestamptz`,
        sql`${readyAt} < ${to.toISOString()}::timestamptz`,
      ),
    )
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    status: r.status,
    reviewStatus: r.reviewStatus,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt,
    finalizedAt: r.finalizedAt,
    completedAt: r.completedAt,
    readyAt: new Date(r.readyAt),
    changed: r.conclusion === 'changes_detected',
  }))
}

/** Bytes of distinct files (screenshots, thumbnails and diffs) each project's builds refer to. */
async function storageByProject(
  db: Database,
  scoped: { id: string; slug: string; name: string; color: string; icon: string | null }[],
): Promise<getInsights.Report['storage']> {
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
  const list = scoped.map((p) => ({
    slug: p.slug,
    name: p.name,
    colour: p.color,
    icon: p.icon,
    bytes: bytes.get(p.id) ?? 0,
  }))
  return { projects: list, totalBytes: list.reduce((s, p) => s + p.bytes, 0) }
}

async function reviewerLoad(
  db: Database,
  input: { workspaceId: string; projectIds: string[]; from: Date; to: Date; now: Date },
): Promise<getInsights.Reviewer[]> {
  const members = await db
    .select({ id: user.id, name: user.name, image: user.image })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.workspaceId, input.workspaceId))
  const load = new Map<string, getInsights.Reviewer>(
    members.map((m) => [
      m.id,
      { ...m, openRequests: 0, overdue: 0, reviews: 0, medianResponseHours: null },
    ]),
  )
  if (input.projectIds.length > 0) {
    // A person's load is the builds they decided on in the range: a build-level decision, or a
    // decision on any of its snapshots. A build's `reviews` row is only written by whoever
    // moves its status, so counting those alone left out everyone who decided some snapshots
    // and someone else finished (or decided the same way as a person before them).
    const decided = new Map<string, Set<string>>()
    const add = (userId: string | null, buildId: string) => {
      if (!userId) return
      const set = decided.get(userId) ?? new Set<string>()
      set.add(buildId)
      decided.set(userId, set)
    }
    const buildLevel = await db
      .selectDistinct({ userId: reviews.userId, buildId: reviews.buildId })
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
    const perSnapshot = await db
      .selectDistinct({ userId: snapshotReviews.userId, buildId: snapshotReviews.buildId })
      .from(snapshotReviews)
      .innerJoin(builds, eq(builds.id, snapshotReviews.buildId))
      .where(
        and(
          inArray(builds.projectId, input.projectIds),
          isNotNull(snapshotReviews.userId),
          ne(snapshotReviews.source, 'auto'),
          gte(snapshotReviews.createdAt, input.from),
          lt(snapshotReviews.createdAt, input.to),
        ),
      )
    for (const d of [...buildLevel, ...perSnapshot]) add(d.userId, d.buildId)
    for (const [userId, set] of decided) {
      const row = load.get(userId)
      if (row) row.reviews = set.size
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
