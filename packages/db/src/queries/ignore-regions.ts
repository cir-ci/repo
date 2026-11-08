import { and, asc, desc, eq, sql } from 'drizzle-orm'

import { builds, files, ignoreRegions, screenshots, teams } from '#schema/index.ts'
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
 * The screenshot names a team has ignore regions for, each with its region count and the latest
 * screenshot from the default branch (null when no build has one any more).
 */
export async function listIgnoreRegionSnapshots(
  db: Database,
  teamId: string,
): Promise<listIgnoreRegionSnapshots.Snapshot[]> {
  const names = await db
    .select({ name: ignoreRegions.name, regions: sql<number>`count(*)::int` })
    .from(ignoreRegions)
    .where(eq(ignoreRegions.teamId, teamId))
    .groupBy(ignoreRegions.name)
    .orderBy(asc(ignoreRegions.name))
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
        .innerJoin(teams, eq(teams.id, builds.teamId))
        .innerJoin(files, eq(files.sha256, screenshots.fileSha256))
        .where(
          and(
            eq(builds.teamId, teamId),
            eq(builds.branch, teams.defaultBranch),
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
