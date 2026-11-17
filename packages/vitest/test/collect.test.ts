import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { collectDirectory } from '#src/collect.ts'

import { useTempRoot } from './support/temp-root.ts'

const tmp = useTempRoot()
const { touch } = tmp

describe('collecting screenshots', () => {
  it("names a directory's pictures by their path", async () => {
    await touch('.circi/screenshots/home.png')
    await touch('.circi/screenshots/settings/profile.png')
    await touch('.circi/screenshots/notes.txt')
    const found = await collectDirectory(join(tmp.root(), '.circi/screenshots'))
    expect(found.map((f) => f.name).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'home',
      'settings/profile',
    ])
  })
})
