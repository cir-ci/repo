import { and, desc, eq, inArray, max, ne, or } from 'drizzle-orm'

import { builds, files, reviews, screenshots } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * The baselines page (PLAN §7.2): for each screenshot name, the image a new default-branch build
 * is compared against, and the build that supplied it.
 */

export interface BaselineItem {
  name: string
  buildName: string
  width: number | null
  height: number | null
  sizeBytes: number | null
  fileSha256: string
  thumbnailSha256: string | null
  buildNumber: number
  commitSha: string
  approvedAt: Date
}

/**
 * The team's current baselines: per build name and screenshot name, the screenshot of the
 * newest eligible build on `defaultBranch`. Eligible is `isEligibleBaseline` in `@circi/core`
 * (finished, and approved or unchanged and not rejected). `approvedAt` is the build's latest
 * approval, or when it finished for a build that needed none.
 */
export async function listBaselines(
  db: Database,
  input: { teamId: string; defaultBranch: string },
): Promise<BaselineItem[]> {
  const rows = await db
    .selectDistinctOn([builds.name, screenshots.name], {
      name: screenshots.name,
      buildName: builds.name,
      buildId: builds.id,
      width: files.width,
      height: files.height,
      sizeBytes: files.size,
      fileSha256: screenshots.fileSha256,
      thumbnailSha256: screenshots.thumbnailSha256,
      buildNumber: builds.number,
      commitSha: builds.commitSha,
      finishedAt: builds.completedAt,
      createdAt: builds.createdAt,
    })
    .from(screenshots)
    .innerJoin(builds, eq(builds.id, screenshots.buildId))
    .innerJoin(files, eq(files.sha256, screenshots.fileSha256))
    .where(
      and(
        eq(builds.teamId, input.teamId),
        eq(builds.branch, input.defaultBranch),
        eq(builds.status, 'complete'),
        or(
          eq(builds.reviewStatus, 'approved'),
          and(eq(builds.conclusion, 'no_changes'), ne(builds.reviewStatus, 'rejected')),
        ),
      ),
    )
    .orderBy(builds.name, screenshots.name, desc(builds.createdAt), desc(builds.number))

  const approvals = new Map<string, Date>()
  const buildIds = [...new Set(rows.map((r) => r.buildId))]
  if (buildIds.length > 0) {
    const approved = await db
      .select({ buildId: reviews.buildId, at: max(reviews.createdAt) })
      .from(reviews)
      .where(and(inArray(reviews.buildId, buildIds), eq(reviews.state, 'approved')))
      .groupBy(reviews.buildId)
    for (const a of approved) if (a.at) approvals.set(a.buildId, a.at)
  }

  return rows.map(({ buildId, finishedAt, createdAt, ...r }) =>
    Object.assign(r, { approvedAt: approvals.get(buildId) ?? finishedAt ?? createdAt }),
  )
}
