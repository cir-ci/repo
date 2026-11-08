import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll } from 'vitest'

/** A temporary project root for the length of one test file, and a way to drop fake pictures in it. */
export function useTempRoot() {
  let root = ''
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'circi-vitest-'))
  })
  afterAll(async () => {
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
