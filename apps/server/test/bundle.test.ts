import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import pkg from '../package.json' with { type: 'json' }

// Builds the Docker image's bundle and checks it stands on its own: the only imports left are
// Node's and this package's `dependencies` (the externals the image installs), and it starts.
const root = join(import.meta.dirname, '..')
const cache = join(root, 'node_modules/.cache')
let out: string

beforeAll(() => {
  mkdirSync(cache, { recursive: true })
  out = mkdtempSync(join(cache, 'bundle-test-'))
  execFileSync('pnpm', ['exec', 'tsdown', '--out-dir', out], { cwd: root, stdio: 'pipe' })
}, 60_000)

afterAll(() => rmSync(out, { recursive: true, force: true }))

const nodeBuiltins = new Set(builtinModules)
const packageName = (spec: string) =>
  spec
    .split('/')
    .slice(0, spec.startsWith('@') ? 2 : 1)
    .join('/')

describe('the server bundle', () => {
  it('imports only Node and the declared externals', () => {
    const specifiers = new Set<string>()
    for (const file of readdirSync(out).filter((f) => f.endsWith('.mjs'))) {
      const code = readFileSync(join(out, file), 'utf8')
      for (const m of code.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+"([^"./][^"]*)"/gm)) {
        specifiers.add(m[1]!)
      }
    }
    const external = [...specifiers]
      .filter((s) => !s.startsWith('node:') && !nodeBuiltins.has(s))
      .map(packageName)
    expect(new Set(external)).toEqual(new Set(Object.keys(pkg.dependencies)))
  })

  it('starts and lists its commands', () => {
    const help = execFileSync('node', [join(out, 'main.mjs'), '--help'], { encoding: 'utf8' })
    for (const command of ['serve', 'worker', 'all', 'migrate', 'admin']) {
      expect(help).toContain(command)
    }
  })

  it('has source maps that lead to our TypeScript, one level above the bundle (/app/apps/... in the image)', () => {
    const map: { sources: string[] } = JSON.parse(readFileSync(join(out, 'main.mjs.map'), 'utf8'))
    const ours = map.sources.filter((s) => !s.includes('node_modules'))
    expect(ours).toContain('../apps/server/src/main.ts')
    expect(ours).toContain('../packages/db/src/client.ts')
    expect(ours.every((s) => /^\.\.\/(apps|packages)\/[^/]+\/src\/.+\.ts$/.test(s))).toBe(true)
  })
})
