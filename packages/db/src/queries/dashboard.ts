import { aliasedTable, and, desc, eq, inArray, lt, sql } from 'drizzle-orm'

import type { Database } from '../client.ts'
import type { BuildCounts } from '../repositories/builds.ts'
import {
  builds,
  files,
  organizations,
  projects,
  screenshotDiffs,
  screenshots,
} from '../schema/index.ts'

/**
 * Read models behind the dashboard: shaped for the UI, read-only, free to join widely.
 * Writes always go through the repositories.
 */

export interface BuildListItem {
  id: string
  number: number
  name: string
  commitSha: string
  branch: string | null
  prNumber: number | null
  status: string
  conclusion: string | null
  reviewStatus: string
  createdAt: Date
  counts: BuildCounts
}

export interface ProjectOverview {
  org: { slug: string; name: string }
  project: { slug: string; name: string; defaultBranch: string }
  latestBuild: BuildListItem | null
}

export async function listProjectsOverview(db: Database): Promise<ProjectOverview[]> {
  const rows = await db
    .select({ org: organizations, project: projects })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .orderBy(organizations.slug, projects.slug)
  return Promise.all(
    rows.map(async ({ org, project }) => {
      const [latest] = await listBuildsForProject(db, project.id, { limit: 1 })
      return {
        org: { slug: org.slug, name: org.name },
        project: { slug: project.slug, name: project.name, defaultBranch: project.defaultBranch },
        latestBuild: latest ?? null,
      }
    }),
  )
}

export async function listBuildsForProject(
  db: Database,
  projectId: string,
  options: { limit: number; beforeNumber?: number },
): Promise<BuildListItem[]> {
  const rows = await db
    .select()
    .from(builds)
    .where(
      and(
        eq(builds.projectId, projectId),
        options.beforeNumber ? lt(builds.number, options.beforeNumber) : undefined,
      ),
    )
    .orderBy(desc(builds.number))
    .limit(options.limit)
  if (rows.length === 0) return []
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
  const byBuild = new Map<string, BuildCounts>()
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
  }))
}

function emptyCounts(): BuildCounts {
  return { added: 0, removed: 0, changed: 0, unchanged: 0, failed: 0, total: 0 }
}

export interface ImageRef {
  sha256: string
  width: number | null
  height: number | null
}

export interface DiffItem {
  id: string
  name: string
  status: string | null
  score: number | null
  changedPixels: number | null
  sizeChanged: boolean
  errorMessage: string | null
  head: (ImageRef & { thumbnail: string | null; metadata: Record<string, unknown> }) | null
  base: (ImageRef & { thumbnail: string | null }) | null
  diff: ImageRef | null
}

export interface BuildDetail {
  build: Omit<BuildListItem, 'counts'> & {
    baseBranch: string | null
    ancestryStatus: string
    baselineSource: string | null
    errorMessage: string | null
    completedAt: Date | null
    counts: BuildCounts
  }
  baseline: { number: number; commitSha: string; branch: string | null } | null
  diffs: DiffItem[]
}

export async function getBuildDetail(
  db: Database,
  projectId: string,
  number: number,
): Promise<BuildDetail | undefined> {
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

  return {
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
    },
    baseline,
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
    })),
  }
}
