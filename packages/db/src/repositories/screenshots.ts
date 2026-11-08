import { asc, desc, eq, max } from 'drizzle-orm'

import { builds, screenshotDiffs, screenshots } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import type { NewScreenshotDiff, Screenshot, ScreenshotDiff } from '#src/types.ts'

/** A build's screenshots and the worker's per-screenshot comparison results. */

export async function listBuildScreenshots(db: Database, buildId: string): Promise<Screenshot[]> {
  return db.select().from(screenshots).where(eq(screenshots.buildId, buildId))
}

export async function setScreenshotThumbnail(
  db: Database,
  screenshotId: string,
  sha256: string,
): Promise<void> {
  await db
    .update(screenshots)
    .set({ thumbnailSha256: sha256 })
    .where(eq(screenshots.id, screenshotId))
}

export async function listBuildDiffs(db: Database, buildId: string): Promise<ScreenshotDiff[]> {
  return db.select().from(screenshotDiffs).where(eq(screenshotDiffs.buildId, buildId))
}

/** Replaces a build's diff rows (processing is idempotent, so a retried job starts clean). */
export async function replaceBuildDiffs(
  db: Database,
  buildId: string,
  diffs: NewScreenshotDiff[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(screenshotDiffs).where(eq(screenshotDiffs.buildId, buildId))
    if (diffs.length > 0) await tx.insert(screenshotDiffs).values(diffs)
  })
}

export async function updateDiff(
  db: Database,
  diffId: string,
  values: Partial<
    Pick<
      NewScreenshotDiff,
      | 'status'
      | 'score'
      | 'changedPixels'
      | 'sizeChanged'
      | 'diffFileSha256'
      | 'jobStatus'
      | 'errorMessage'
    >
  >,
): Promise<void> {
  await db.update(screenshotDiffs).set(values).where(eq(screenshotDiffs.id, diffId))
}

/** Distinct snapshot names the project's builds have uploaded, most recently seen first. */
export async function listProjectSnapshotNames(
  db: Database,
  projectId: string,
  limit = 2000,
): Promise<string[]> {
  const rows = await db
    .select({ name: screenshots.name, last: max(screenshots.createdAt) })
    .from(screenshots)
    .innerJoin(builds, eq(builds.id, screenshots.buildId))
    .where(eq(builds.projectId, projectId))
    .groupBy(screenshots.name)
    .orderBy(desc(max(screenshots.createdAt)), asc(screenshots.name))
    .limit(limit)
  return rows.map((r) => r.name)
}
