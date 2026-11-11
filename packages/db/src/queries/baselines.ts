import { and, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm'

import { builds, files, reviews, screenshots, snapshotReviews, user } from '#schema/index.ts'
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
  /** Who approved it; null for an automatic approval, a build that needed none, or a deleted account. */
  approvedBy: { id: string; name: string } | null
}

/**
 * The project's current baselines: per build name and screenshot name, the screenshot of the
 * newest eligible build on `defaultBranch`. Eligible is `isEligibleBaseline` in `@circi/core`
 * (finished, and approved or unchanged and not rejected), judged per snapshot: a snapshot
 * approved on its own counts even while its build is still pending, a rejected one never does.
 * `approvedAt` is the snapshot's approval, else the build's latest approval, or when it finished
 * for a build that needed none; `approvedBy` is whoever made that approval.
 */
export async function listBaselines(
  db: Database,
  input: { projectId: string; defaultBranch: string },
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
      snapshotApprovedAt: snapshotReviews.createdAt,
      snapshotApprovedBy: snapshotReviews.userId,
    })
    .from(screenshots)
    .innerJoin(builds, eq(builds.id, screenshots.buildId))
    .leftJoin(
      snapshotReviews,
      and(
        eq(snapshotReviews.buildId, screenshots.buildId),
        eq(snapshotReviews.snapshotName, screenshots.name),
        isNull(snapshotReviews.supersededAt),
      ),
    )
    .innerJoin(files, eq(files.sha256, screenshots.fileSha256))
    .where(
      and(
        eq(builds.projectId, input.projectId),
        eq(builds.branch, input.defaultBranch),
        eq(builds.status, 'complete'),
        or(
          eq(snapshotReviews.decision, 'approved'),
          and(
            isNull(snapshotReviews.decision),
            or(
              eq(builds.reviewStatus, 'approved'),
              and(eq(builds.conclusion, 'no_changes'), ne(builds.reviewStatus, 'rejected')),
            ),
          ),
        ),
      ),
    )
    .orderBy(builds.name, screenshots.name, desc(builds.createdAt), desc(builds.number))

  const approvals = new Map<string, { at: Date; userId: string | null }>()
  const buildIds = [...new Set(rows.map((r) => r.buildId))]
  if (buildIds.length > 0) {
    const approved = await db
      .select({ buildId: reviews.buildId, at: reviews.createdAt, userId: reviews.userId })
      .from(reviews)
      .where(and(inArray(reviews.buildId, buildIds), eq(reviews.state, 'approved')))
      .orderBy(desc(reviews.createdAt))
    for (const a of approved) if (!approvals.has(a.buildId)) approvals.set(a.buildId, a)
  }

  const approverIds = new Set<string>()
  const picked = rows.map(
    ({ buildId, finishedAt, createdAt, snapshotApprovedAt, snapshotApprovedBy, ...rest }) => {
      const fromBuild = approvals.get(buildId)
      const userId = snapshotApprovedAt ? snapshotApprovedBy : (fromBuild?.userId ?? null)
      if (userId) approverIds.add(userId)
      const approvedAt = snapshotApprovedAt ?? fromBuild?.at ?? finishedAt ?? createdAt
      return { rest, userId, approvedAt }
    },
  )
  const names = new Map<string, string>()
  if (approverIds.size > 0) {
    const found = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(inArray(user.id, [...approverIds]))
    for (const u of found) names.set(u.id, u.name)
  }

  return picked.map(({ rest, userId, approvedAt }) => {
    const name = userId ? names.get(userId) : undefined
    return Object.assign(rest, {
      approvedAt,
      approvedBy: userId && name ? { id: userId, name } : null,
    })
  })
}
