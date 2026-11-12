import { asc, desc, eq, max, sql } from 'drizzle-orm'

import {
  builds,
  type DiffJobStatus,
  type DiffStatus,
  files,
  screenshotDiffs,
  screenshots,
} from '#schema/index.ts'
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

/**
 * Gives a build's screenshots the thumbnails their files already have, in one statement. The
 * thumbnail belongs to the content-addressed file; screenshots carry a copy so the read models
 * (and the garbage collector) need no join.
 */
export async function copyFileThumbnailsToScreenshots(
  db: Database,
  buildId: string,
): Promise<void> {
  await db.execute(sql`
    update ${screenshots} s
    set thumbnail_sha256 = f.thumbnail_sha256
    from ${files} f
    where s.build_id = ${buildId}
      and f.sha256 = s.file_sha256
      and f.thumbnail_sha256 is not null
      and s.thumbnail_sha256 is distinct from f.thumbnail_sha256
  `)
}

export async function listBuildDiffs(db: Database, buildId: string): Promise<ScreenshotDiff[]> {
  return db.select().from(screenshotDiffs).where(eq(screenshotDiffs.buildId, buildId))
}

/** Rows per statement: 12 columns each, far below Postgres' 65,535-parameter limit. */
const DIFF_INSERT_CHUNK = 1000

/** Replaces a build's diff rows (processing is idempotent, so a retried job starts clean). */
export async function replaceBuildDiffs(
  db: Database,
  buildId: string,
  diffs: NewScreenshotDiff[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(screenshotDiffs).where(eq(screenshotDiffs.buildId, buildId))
    for (let i = 0; i < diffs.length; i += DIFF_INSERT_CHUNK) {
      // eslint-disable-next-line no-await-in-loop -- chunks of one transaction run in order
      await tx.insert(screenshotDiffs).values(diffs.slice(i, i + DIFF_INSERT_CHUNK))
    }
  })
}

/** The outcome of one diff, as `updateDiffs` writes it: every column, so a batch is one statement. */
export interface DiffResult {
  id: string
  status: DiffStatus | null
  score: number | null
  changedPixels: number | null
  ignoredChangedPixels: number
  ignoredRegions: string[]
  sizeChanged: boolean
  diffFileSha256: string | null
  jobStatus: DiffJobStatus
  errorMessage: string | null
}

const DIFF_UPDATE_CHUNK = 1000

/** Writes many diff outcomes with `UPDATE ... FROM` a JSON recordset: one statement per 1000 rows. */
export async function updateDiffs(db: Database, results: DiffResult[]): Promise<void> {
  for (let i = 0; i < results.length; i += DIFF_UPDATE_CHUNK) {
    const chunk = results.slice(i, i + DIFF_UPDATE_CHUNK).map((r) => ({
      id: r.id,
      status: r.status,
      score: r.score,
      changed_pixels: r.changedPixels,
      ignored_changed_pixels: r.ignoredChangedPixels,
      ignored_regions: r.ignoredRegions,
      size_changed: r.sizeChanged,
      diff_file_sha256: r.diffFileSha256,
      job_status: r.jobStatus,
      error_message: r.errorMessage,
    }))
    // eslint-disable-next-line no-await-in-loop -- one statement per chunk, in order
    await db.execute(sql`
      update ${screenshotDiffs} d
      set status = v.status,
          score = v.score,
          changed_pixels = v.changed_pixels,
          ignored_changed_pixels = v.ignored_changed_pixels,
          ignored_regions = array(select jsonb_array_elements_text(v.ignored_regions)),
          size_changed = v.size_changed,
          diff_file_sha256 = v.diff_file_sha256,
          job_status = v.job_status,
          error_message = v.error_message
      from jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) as v(
        id uuid, status text, score real, changed_pixels integer, ignored_changed_pixels integer,
        ignored_regions jsonb, size_changed boolean, diff_file_sha256 text, job_status text,
        error_message text
      )
      where d.id = v.id
    `)
  }
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
