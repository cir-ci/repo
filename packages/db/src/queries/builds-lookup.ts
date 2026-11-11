import { and, eq, inArray, lt } from 'drizzle-orm'

import { buildShards, builds } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import type { Build } from '#src/types.ts'

/** Finding builds: by id, by number, and the ones that stalled. */

export async function getBuild(db: Database, buildId: string): Promise<Build | undefined> {
  const [row] = await db.select().from(builds).where(eq(builds.id, buildId))
  return row
}

/** The builds among `buildIds` that belong to `projectId` (ids of other projects are left out). */
export async function listProjectBuildsByIds(
  db: Database,
  projectId: string,
  buildIds: string[],
): Promise<Build[]> {
  if (buildIds.length === 0) return []
  return db
    .select()
    .from(builds)
    .where(and(eq(builds.projectId, projectId), inArray(builds.id, buildIds)))
}

/** A build by its per-project number, the number people see in URLs and on screen. */
export async function getBuildByNumber(
  db: Database,
  projectId: string,
  number: number,
): Promise<Build | undefined> {
  const [row] = await db
    .select()
    .from(builds)
    .where(and(eq(builds.projectId, projectId), eq(builds.number, number)))
  return row
}

export async function getProjectBuild(
  db: Database,
  projectId: string,
  buildId: string,
): Promise<Build | undefined> {
  const [row] = await db
    .select()
    .from(builds)
    .where(and(eq(builds.id, buildId), eq(builds.projectId, projectId)))
  return row
}

/** A build that was never finished, with the shards it did receive. */
export interface StalledBuild {
  build: Build
  /** Indexes of the shards that arrived. */
  receivedShards: string[]
}

/** Builds still waiting for uploads that were created before `cutoff`. */
export async function listStalledBuilds(db: Database, cutoff: Date): Promise<StalledBuild[]> {
  const stalled = await db
    .select()
    .from(builds)
    .where(and(inArray(builds.status, ['pending', 'uploading']), lt(builds.createdAt, cutoff)))
  if (stalled.length === 0) return []
  const shards = await db
    .select({ buildId: buildShards.buildId, shardIndex: buildShards.shardIndex })
    .from(buildShards)
    .where(
      inArray(
        buildShards.buildId,
        stalled.map((b) => b.id),
      ),
    )
  return stalled.map((build) => ({
    build,
    receivedShards: shards.filter((s) => s.buildId === build.id).map((s) => s.shardIndex),
  }))
}
