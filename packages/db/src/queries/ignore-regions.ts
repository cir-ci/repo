import { and, asc, desc, eq, sql } from 'drizzle-orm'

import { builds, files, ignoreRegions, screenshots, projects } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

export namespace listIgnoreRegionSnapshots {
  export interface Snapshot {
    /** The screenshot name. */
    name: string
    regions: number
    /** The newest complete default-branch build's screenshot of that name, to draw regions on. */
    latest: {
      buildNumber: number
      sha256: string
      width: number | null
      height: number | null
    } | null
  }
}

/**
 * The screenshot names a project has ignore regions for, each with its region count and the latest
 * screenshot from the default branch (null when no build has one any more). `also` names one more
 * screenshot to list when it has no regions yet (zero regions), so a page can open on it ready to add one.
 */
export async function listIgnoreRegionSnapshots(
  db: Database,
  projectId: string,
  also?: string,
): Promise<listIgnoreRegionSnapshots.Snapshot[]> {
  const names = await db
    .select({ name: ignoreRegions.name, regions: sql<number>`count(*)::int` })
    .from(ignoreRegions)
    .where(eq(ignoreRegions.projectId, projectId))
    .groupBy(ignoreRegions.name)
    .orderBy(asc(ignoreRegions.name))
  if (also && !names.some((n) => n.name === also)) names.push({ name: also, regions: 0 })
  return Promise.all(
    names.map(async ({ name, regions }) => {
      const [latest] = await db
        .select({
          buildNumber: builds.number,
          sha256: screenshots.fileSha256,
          width: files.width,
          height: files.height,
        })
        .from(screenshots)
        .innerJoin(builds, eq(builds.id, screenshots.buildId))
        .innerJoin(projects, eq(projects.id, builds.projectId))
        .innerJoin(files, eq(files.sha256, screenshots.fileSha256))
        .where(
          and(
            eq(builds.projectId, projectId),
            eq(builds.branch, projects.defaultBranch),
            eq(builds.status, 'complete'),
            eq(screenshots.name, name),
          ),
        )
        .orderBy(desc(builds.number))
        .limit(1)
      return { name, regions, latest: latest ?? null }
    }),
  )
}
