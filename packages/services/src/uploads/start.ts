import { type Build, type Database, planUploads } from '@circi/db'

import { startBuild } from '#src/builds.ts'

/**
 * Creates a build (or joins a parallel one) and records the files it asks for, in one
 * transaction, so a build never exists without the claims on its files. Returns the build and
 * the files that still need uploading (`planUploads`'s answer).
 */
export async function startBuildUpload(
  db: Database,
  input: startBuildUpload.Input,
): Promise<startBuildUpload.Result> {
  return db.transaction(async (tx) => {
    const build = await startBuild(tx, input.build)
    const planned = await planUploads(tx, {
      buildId: build.id,
      kind: 'screenshot',
      files: input.files,
      storageKeyFor: input.storageKeyFor,
    })
    return { build, planned }
  })
}

export namespace startBuildUpload {
  export interface Input {
    build: Parameters<typeof startBuild>[1]
    files: planUploads.File[]
    /** Makes the storage key of a file that is new to the store. */
    storageKeyFor: (sha256: string) => string
  }

  export interface Result {
    build: Build
    planned: planUploads.Planned[]
  }
}
