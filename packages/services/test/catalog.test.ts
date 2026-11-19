import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Every dependency's version lives in pnpm-workspace.yaml's catalog, the workspace's own packages too
 * (`workspace:*` there). `catalogMode: strict` makes `pnpm add` write `catalog:`, and pnpm refuses a
 * `catalog:` entry the catalog doesn't have; this catches the rest: a version written into a
 * package.json by hand. peerDependencies are left out: they are the range a package asks of its
 * users (`vitest: >=4`), not a version installed here.
 */
const root = join(import.meta.dirname, '../../..')
const workspace: { path: string }[] = JSON.parse(
  execFileSync('pnpm', ['list', '--recursive', '--depth', '-1', '--json'], {
    cwd: root,
    encoding: 'utf8',
  }),
)

describe('dependency versions', () => {
  it('come from the catalog in every package.json', () => {
    const written: string[] = []
    for (const { path } of workspace) {
      const file = join(relative(root, path), 'package.json')
      const manifest: Record<string, Record<string, string> | undefined> = JSON.parse(
        readFileSync(join(root, file), 'utf8'),
      )
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
          if (spec !== 'catalog:') {
            written.push(`${file}: ${field}.${name} is "${spec}"`)
          }
        }
      }
    }
    expect(written, 'use "catalog:" and put the version in pnpm-workspace.yaml').toEqual([])
  })
})
