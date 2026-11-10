import { ValidationError } from '@circi/core'
import { type Build, type Database } from '@circi/db'
import { getFile, getTeamBuild } from '@circi/db/queries'
import { markFileVerified, setParallelTotal } from '@circi/db/repositories'
import type { StorageDriver } from '@circi/storage'

import { finalizeBuild } from '#src/builds/lifecycle.ts'

/**
 * A shard (or a chunk of one) of a team's build reports its screenshots. The one entry for
 * every upload route: it looks the build up in the team, optionally corrects the parallel total
 * and confirms directly-uploaded files, then hands the shard to `finalizeBuild`, which owns the
 * build's state change.
 */
export async function finalizeTeamBuild(
  db: Database,
  input: finalizeTeamBuild.Input,
): Promise<finalizeTeamBuild.Result> {
  const build = await getTeamBuild(db, input.teamId, input.buildId)
  if (!build) return { status: 'not-found' }

  // Direct-to-storage uploads: confirm the stored object's checksum before trusting it.
  if (input.verifyIn) {
    await verifyStoredObjects(db, input.verifyIn, [
      ...new Set(input.shard.screenshots.map((s) => s.sha256)),
    ])
  }
  const total = input.parallelTotal
  if (total !== undefined) {
    if (total < 1) {
      throw new ValidationError(
        "Parallel builds that are finalized manually (parallelTotal -1) aren't supported: pass the total number of shards",
      )
    }
    await db.transaction((tx) => setParallelTotal(tx, build.id, total))
  }
  const result = await finalizeBuild(db, { buildId: build.id, ...input.shard })
  if (result.status === 'missing') return { status: 'missing', missing: result.missing }
  return {
    status: 'ok',
    build: (await getTeamBuild(db, input.teamId, input.buildId)) ?? build,
    complete: result.complete,
    shardsReceived: result.shardsReceived,
    shardsTotal: result.shardsTotal,
  }
}

export namespace finalizeTeamBuild {
  export interface Input {
    teamId: string
    buildId: string
    /** The shard, as `finalizeBuild` takes it. */
    shard: Omit<Parameters<typeof finalizeBuild>[1], 'buildId'>
    /** Argos SDKs learn the number of shards late: corrects it before the shard is applied. */
    parallelTotal?: number | undefined
    /** With storage that takes uploads directly (S3): check each pending object's checksum. */
    verifyIn?: StorageDriver | undefined
  }

  export type Result =
    | { status: 'not-found' }
    | { status: 'missing'; missing: string[] }
    | {
        status: 'ok'
        build: Build
        complete: boolean
        shardsReceived: number
        shardsTotal: number
      }
}

/** S3 uploads go straight to storage; verify each pending object's stored checksum. */
async function verifyStoredObjects(
  db: Database,
  storage: StorageDriver,
  shas: string[],
): Promise<void> {
  await Promise.all(
    shas.map(async (hash) => {
      const file = await getFile(db, hash)
      if (!file || file.status === 'verified') return
      const info = await storage.head(file.storageKey)
      if (info?.sha256 === hash) {
        await db.transaction((tx) => markFileVerified(tx, hash, { size: info.size }))
      }
    }),
  )
}
