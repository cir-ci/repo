import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll } from 'vitest'

export namespace useTempDir {
  export interface Result {
    /** The directory's path; set once `beforeAll` has run. */
    readonly path: string
  }
}

/**
 * A temporary directory for a test file: made in `beforeAll` (named `prefix` plus random
 * characters) and removed in `afterAll`. Call it at the top level of the file or of a `describe`.
 */
export function useTempDir(prefix: string): useTempDir.Result {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), `${prefix}-`))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  return {
    get path() {
      return dir
    },
  }
}
