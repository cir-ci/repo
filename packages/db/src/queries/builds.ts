import { ISSUE_LINK_KIND, isSnoozed } from '@circi/core'
import type { BuildOrder } from '@circi/core'
import { aliasedTable, and, eq, gt, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm'

import {
  type AncestryStatus,
  type BaselineSource,
  type BuildConclusion,
  type BuildStatus,
  builds,
  type DiffStatus,
  user,
  type ReviewStatus,
  files,
  reviewRequests,
  screenshotDiffs,
  screenshots,
  projects,
} from '#schema/index.ts'
import type { getBuildCounts } from '#shared/build-counts.ts'
import { containsPattern, prefixPattern } from '#shared/like.ts'
import type { Database } from '#src/client.ts'

import { buildAfterCursor, buildOrderBy, projectTie } from './builds-order.ts'
import { figmaFramesForSnapshots } from './figma.ts'
import { type GitKinds, getProjectLink } from './git-links.ts'
import { listBuildLinks } from './integration-links.ts'
import {
  listBuildReviews,
  listSnapshotReviews,
  type ReviewEntry,
  type SnapshotReviewEntry,
} from './review-decisions.ts'

/** Build read models for the dashboard: shaped for the UI, read-only, free to join widely. */

export namespace listBuildsForProject {
  export interface Item {
    id: string
    number: number
    name: string
    commitSha: string
    branch: string | null
    prNumber: number | null
    status: BuildStatus
    conclusion: BuildConclusion | null
    reviewStatus: ReviewStatus
    createdAt: Date
    counts: getBuildCounts.Counts
    author: listBuildsForProject.Author | null
  }

  /** Who made a build: the login the CI or git host gave, and the member it matched, if any. */
  export interface Author {
    login: string
    /** The member's name, when the author is matched to one. */
    name: string | null
    /** The member's profile picture, when matched and they have one. */
    avatarUrl: string | null
  }

  /** Narrows a project's builds list; every field given must match. */
  export interface Filters {
    /** The build's own status (uploading, complete, error…). */
    status?: BuildStatus
    /** The review state. */
    reviewStatus?: ReviewStatus
    /** Exactly this branch. */
    branch?: string
    /** A branch whose name contains this text, in any case. */
    branchContains?: string
    /** Free text: a build number, PR number, commit prefix, build name, branch or author name. */
    text?: string
    /** A login (any case) or a member's user id. */
    author?: string
    /** A member's user id: builds with an open review request for them. */
    reviewer?: string
    /** The build's name (a project can upload several per commit). */
    name?: string
    /** Created at or after. */
    from?: Date
    /** Created before. */
    to?: Date
  }
}

function toAuthor(
  build: { authorLogin: string | null },
  member: { name: string; image: string | null } | null,
): listBuildsForProject.Author | null {
  const login = build.authorLogin ?? member?.name
  return login ? { login, name: member?.name ?? null, avatarUrl: member?.image ?? null } : null
}

/** The builds a free-text `q` finds: by number, PR number, commit prefix, name, branch or author. */
function textCondition(text: string) {
  const like = containsPattern(text)
  const numeric = /^#?(\d{1,9})$/.exec(text.trim())
  const n = numeric ? Number(numeric[1]) : undefined
  return or(
    n === undefined ? undefined : or(eq(builds.number, n), eq(builds.prNumber, n)),
    /^[0-9a-f]{4,40}$/i.test(text.trim())
      ? ilike(builds.commitSha, prefixPattern(text.trim()))
      : undefined,
    ilike(builds.name, like),
    ilike(builds.branch, like),
    ilike(builds.authorLogin, like),
    sql`exists (select 1 from ${user} where ${user.id} = ${builds.authorUserId} and ${user.name} ilike ${like})`,
  )
}

export function buildFilterConditions(f: listBuildsForProject.Filters) {
  return [
    f.text === undefined ? undefined : textCondition(f.text),
    f.status ? eq(builds.status, f.status) : undefined,
    f.reviewStatus ? eq(builds.reviewStatus, f.reviewStatus) : undefined,
    f.branch === undefined ? undefined : eq(builds.branch, f.branch),
    f.branchContains === undefined
      ? undefined
      : ilike(builds.branch, containsPattern(f.branchContains)),
    f.name === undefined ? undefined : eq(builds.name, f.name),
    f.author === undefined
      ? undefined
      : sql`(lower(${builds.authorLogin}) = lower(${f.author}) or ${builds.authorUserId} = ${f.author})`,
    f.reviewer === undefined
      ? undefined
      : sql`exists (select 1 from ${reviewRequests} where ${reviewRequests.buildId} = ${builds.id} and ${reviewRequests.reviewerId} = ${f.reviewer} and ${reviewRequests.state} = 'open')`,
    f.from ? gte(builds.createdAt, f.from) : undefined,
    f.to ? lt(builds.createdAt, f.to) : undefined,
  ]
}

export async function listBuildsForProject(
  db: Database,
  projectId: string,
  options: {
    limit: number
    /** The build number the page starts after, in `order`. */
    beforeNumber?: number
    filters?: listBuildsForProject.Filters
    /** Default newest first. */
    order?: BuildOrder
  },
): Promise<listBuildsForProject.Item[]> {
  const order = options.order ?? 'newest'
  const after = options.beforeNumber
  const found = await db
    .select({ build: builds, member: { name: user.name, image: user.image } })
    .from(builds)
    .leftJoin(user, eq(user.id, builds.authorUserId))
    .where(
      and(
        eq(builds.projectId, projectId),
        after === undefined
          ? undefined
          : order === 'newest'
            ? lt(builds.number, after)
            : order === 'oldest'
              ? gt(builds.number, after)
              : buildAfterCursor(
                  order,
                  projectTie,
                  (c) => sql`${c.projectId} = ${projectId} and ${c.number} = ${after}`,
                ),
        ...buildFilterConditions(options.filters ?? {}),
      ),
    )
    .orderBy(...buildOrderBy(order, projectTie))
    .limit(options.limit)
  return hydrateBuildList(db, found)
}

/** The builds with their screenshot counts and authors: what both builds lists show. */
export async function hydrateBuildList(
  db: Database,
  found: {
    build: typeof builds.$inferSelect
    member: { name: string; image: string | null } | null
  }[],
): Promise<listBuildsForProject.Item[]> {
  if (found.length === 0) return []
  const rows = found.map((f) => f.build)
  const members = new Map(found.map((f) => [f.build.id, f.member]))
  const counts = await db
    .select({
      buildId: screenshotDiffs.buildId,
      status: screenshotDiffs.status,
      n: sql<number>`count(*)::int`,
    })
    .from(screenshotDiffs)
    .where(
      inArray(
        screenshotDiffs.buildId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(screenshotDiffs.buildId, screenshotDiffs.status)
  const byBuild = new Map<string, getBuildCounts.Counts>()
  for (const c of counts) {
    const entry = byBuild.get(c.buildId) ?? emptyCounts()
    if (c.status && c.status in entry) entry[c.status] += c.n
    entry.total += c.n
    byBuild.set(c.buildId, entry)
  }
  return rows.map((b) => ({
    id: b.id,
    number: b.number,
    name: b.name,
    commitSha: b.commitSha,
    branch: b.branch,
    prNumber: b.prNumber,
    status: b.status,
    conclusion: b.conclusion,
    reviewStatus: b.reviewStatus,
    createdAt: b.createdAt,
    counts: byBuild.get(b.id) ?? emptyCounts(),
    author: toAuthor(b, members.get(b.id) ?? null),
  }))
}

function emptyCounts(): getBuildCounts.Counts {
  return { added: 0, removed: 0, changed: 0, unchanged: 0, failed: 0, total: 0 }
}

export namespace getBuildDetail {
  export interface ImageRef {
    sha256: string
    width: number | null
    height: number | null
  }

  export interface DiffItem {
    id: string
    name: string
    status: DiffStatus | null
    score: number | null
    changedPixels: number | null
    sizeChanged: boolean
    errorMessage: string | null
    head:
      | (getBuildDetail.ImageRef & { thumbnail: string | null; metadata: Record<string, unknown> })
      | null
    base: (getBuildDetail.ImageRef & { thumbnail: string | null }) | null
    diff: getBuildDetail.ImageRef | null
    /** The Figma frame the snapshot is linked to, if any. */
    figma: figmaFramesForSnapshots.Frame | null
    /** The current decision on the snapshot, if any. */
    review: Omit<SnapshotReviewEntry, 'name'> | null
  }

  export interface Detail {
    build: Omit<listBuildsForProject.Item, 'counts'> & {
      baseBranch: string | null
      ancestryStatus: AncestryStatus
      baselineSource: BaselineSource | null
      errorMessage: string | null
      completedAt: Date | null
      counts: getBuildCounts.Counts
    }
    baseline: { number: number; commitSha: string; branch: string | null } | null
    /** Approve/reject decisions, newest first. */
    reviews: ReviewEntry[]
    diffs: getBuildDetail.DiffItem[]
    /** Issues created from the build, oldest first. */
    issues: { key: string; url: string; title: string }[]
    /**
     * The project's review target and when the soonest open request runs out (null when no request
     * is open and unsnoozed, or the project has no target).
     */
    reviewTarget: { hours: number | null; dueAt: Date | null }
    /** The member the build's author is matched to; null when the author is only a git login. */
    authorUserId: string | null
    /** The people who get notified about the build: its author and whoever was asked to review. */
    watchers: { id: string; name: string; image: string | null }[]
    /** The pull request the build is for; `repo` is the connected repository, when there is one. */
    pullRequest: { number: number; repo: string | null } | null
  }
}

export async function getBuildDetail(
  db: Database,
  projectId: string,
  number: number,
  gitKinds: GitKinds = [],
): Promise<getBuildDetail.Detail | undefined> {
  const [build] = await db
    .select()
    .from(builds)
    .where(and(eq(builds.projectId, projectId), eq(builds.number, number)))
  if (!build) return undefined
  const [list] = await listBuildsForProject(db, projectId, { limit: 1, beforeNumber: number + 1 })
  const counts = list?.id === build.id ? list.counts : emptyCounts()

  const baseline = build.baseBuildId
    ? ((
        await db
          .select({ number: builds.number, commitSha: builds.commitSha, branch: builds.branch })
          .from(builds)
          .where(eq(builds.id, build.baseBuildId))
      )[0] ?? null)
    : null

  const head = aliasedTable(screenshots, 'head')
  const base = aliasedTable(screenshots, 'base')
  const headFile = aliasedTable(files, 'head_file')
  const baseFile = aliasedTable(files, 'base_file')
  const diffFile = aliasedTable(files, 'diff_file')
  const rows = await db
    .select({
      diff: screenshotDiffs,
      head: { sha256: head.fileSha256, thumbnail: head.thumbnailSha256, metadata: head.metadata },
      headDims: { width: headFile.width, height: headFile.height },
      base: { sha256: base.fileSha256, thumbnail: base.thumbnailSha256 },
      baseDims: { width: baseFile.width, height: baseFile.height },
      diffDims: { width: diffFile.width, height: diffFile.height },
    })
    .from(screenshotDiffs)
    .leftJoin(head, eq(head.id, screenshotDiffs.headScreenshotId))
    .leftJoin(base, eq(base.id, screenshotDiffs.baseScreenshotId))
    .leftJoin(headFile, eq(headFile.sha256, head.fileSha256))
    .leftJoin(baseFile, eq(baseFile.sha256, base.fileSha256))
    .leftJoin(diffFile, eq(diffFile.sha256, screenshotDiffs.diffFileSha256))
    .where(eq(screenshotDiffs.buildId, build.id))
    .orderBy(screenshotDiffs.name)

  const decisions = await listBuildReviews(db, build.id)
  const snapshotDecisions = new Map(
    (await listSnapshotReviews(db, build.id)).map(({ name, ...r }) => [name, r]),
  )
  const frames = await figmaFramesForSnapshots(
    db,
    projectId,
    rows.map((r) => r.diff.name),
  )
  const issues = (await listBuildLinks(db, build.id, ISSUE_LINK_KIND)).map((l) => ({
    key: l.externalRef,
    url: l.url ?? '',
    title: l.title ?? l.externalRef,
  }))

  const [project] = await db
    .select({ hours: projects.reviewTargetHours })
    .from(projects)
    .where(eq(projects.id, projectId))
  const asked = await db
    .select({
      id: user.id,
      name: user.name,
      image: user.image,
      dueAt: reviewRequests.dueAt,
      snoozedUntil: reviewRequests.snoozedUntil,
      snoozeKind: reviewRequests.snoozeKind,
    })
    .from(reviewRequests)
    .innerJoin(user, eq(user.id, reviewRequests.reviewerId))
    .where(and(eq(reviewRequests.buildId, build.id), eq(reviewRequests.state, 'open')))
    .orderBy(reviewRequests.createdAt)
  const now = new Date()
  const dues = asked.flatMap((r) => (r.dueAt && !isSnoozed(r, now) ? [r.dueAt] : []))
  const author = build.authorUserId
    ? (
        await db
          .select({ id: user.id, name: user.name, image: user.image })
          .from(user)
          .where(eq(user.id, build.authorUserId))
      )[0]
    : undefined
  const watchers = new Map<string, { id: string; name: string; image: string | null }>()
  for (const p of [...(author ? [author] : []), ...asked]) {
    watchers.set(p.id, { id: p.id, name: p.name, image: p.image })
  }
  const link = build.prNumber ? await getProjectLink(db, projectId, gitKinds) : undefined

  return {
    reviewTarget: {
      hours: project?.hours ?? null,
      dueAt: dues.length > 0 ? new Date(Math.min(...dues.map((d) => d.getTime()))) : null,
    },
    authorUserId: author?.id ?? null,
    watchers: [...watchers.values()],
    pullRequest: build.prNumber ? { number: build.prNumber, repo: link?.repoRef ?? null } : null,
    build: {
      id: build.id,
      number: build.number,
      name: build.name,
      commitSha: build.commitSha,
      branch: build.branch,
      prNumber: build.prNumber,
      baseBranch: build.baseBranch,
      status: build.status,
      conclusion: build.conclusion,
      reviewStatus: build.reviewStatus,
      ancestryStatus: build.ancestryStatus,
      baselineSource: build.baselineSource,
      errorMessage: build.errorMessage,
      createdAt: build.createdAt,
      completedAt: build.completedAt,
      counts,
      author: list?.id === build.id ? list.author : null,
    },
    baseline,
    reviews: decisions,
    issues,
    diffs: rows.map((r) => ({
      id: r.diff.id,
      name: r.diff.name,
      status: r.diff.status,
      score: r.diff.score,
      changedPixels: r.diff.changedPixels,
      sizeChanged: r.diff.sizeChanged,
      errorMessage: r.diff.errorMessage,
      head: r.head?.sha256
        ? {
            sha256: r.head.sha256,
            thumbnail: r.head.thumbnail,
            metadata: r.head.metadata ?? {},
            width: r.headDims?.width ?? null,
            height: r.headDims?.height ?? null,
          }
        : null,
      base: r.base?.sha256
        ? {
            sha256: r.base.sha256,
            thumbnail: r.base.thumbnail,
            width: r.baseDims?.width ?? null,
            height: r.baseDims?.height ?? null,
          }
        : null,
      diff: r.diff.diffFileSha256
        ? {
            sha256: r.diff.diffFileSha256,
            width: r.diffDims?.width ?? null,
            height: r.diffDims?.height ?? null,
          }
        : null,
      figma: frames.get(r.diff.name) ?? null,
      review: snapshotDecisions.get(r.diff.name) ?? null,
    })),
  }
}
