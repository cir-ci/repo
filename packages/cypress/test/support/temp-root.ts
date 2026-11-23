import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach } from 'vitest'

/** A temporary project root for the length of one test, with a way to drop a "screenshot" in it. */
export function useTempRoot() {
  let root = ''
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'circi-cypress-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })
  return {
    root: () => root,
    /** A file Cypress "wrote", at the path the `after:screenshot` details name. */
    cypressWrote: async (name: string, content = 'png') => {
      const path = join(root, name)
      await writeFile(path, content)
      return path
    },
  }
}
