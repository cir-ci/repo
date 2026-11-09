import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach } from 'vitest'

/** A temporary project root for the length of one test, and a way to drop fake pictures in it. */
export function useTempRoot() {
  let root = ''
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'circi-vitest-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })
  return {
    root: () => root,
    touch: async (rel: string) => {
      const path = join(root, rel)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, 'png')
    },
  }
}
