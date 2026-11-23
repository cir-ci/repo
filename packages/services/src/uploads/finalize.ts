import { type Build, type Database } from '@circi/db'
import { getFile, getProjectBuild } from '@circi/db/queries'
import { markFileVerified } from '@circi/db/repositories'
import type { StorageDriver } from '@circi/storage'

import { finalizeBuild } from '#src/builds/lifecycle.ts'

/**
 * A shard (or a chunk of one) of a project's build reports its screenshots. The one entry for
 * every upload route: it looks the build up in the project, confirms directly-uploaded files, then hands the shard to `finalizeBuild`, which owns the
 * build's state change.
 */
export async function finalizeProjectBuild(
  db: Database,
  input: finalizeProjectBuild.Input,
): Promise<finalizeProjectBuild.Result> {
  const build = await getProjectBuild(db, input.projectId, input.buildId)
  if (!build) return { status: 'not-found' }

  // Direct-to-storage uploads: confirm the stored object's checksum before trusting it.
  if (input.verifyIn) {
    await verifyStoredObjects(db, input.verifyIn, [
      ...new Set(input.shard.screenshots.map((s) => s.sha256)),
    ])
  }
  const result = await finalizeBuild(db, { buildId: build.id, ...input.shard })
  if (result.status === 'missing') return { status: 'missing', missing: result.missing }
  return {
    status: 'ok',
    build: (await getProjectBuild(db, input.projectId, input.buildId)) ?? build,
    complete: result.complete,
    shardsReceived: result.shardsReceived,
    shardsTotal: result.shardsTotal,
  }
}

export namespace finalizeProjectBuild {
  export interface Input {
    projectId: string
    buildId: string
    /** The shard, as `finalizeBuild` takes it. */
    shard: Omit<Parameters<typeof finalizeBuild>[1], 'buildId'>
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
