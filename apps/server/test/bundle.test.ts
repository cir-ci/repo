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

// Imports a library tries inside try/catch and does without: not installed, and not needed.
const OPTIONAL = new Set([
  // better-auth's tracing, used only when the app has OpenTelemetry.
  '@opentelemetry/api',
])

describe('the server bundle', () => {
  it('imports only Node and the declared externals', () => {
    const specifiers = new Set<string>()
    for (const file of readdirSync(out).filter((f) => f.endsWith('.mjs'))) {
      const code = readFileSync(join(out, file), 'utf8')
      for (const m of code.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+"([^"./][^"]*)"/gm)) {
        specifiers.add(m[1]!)
      }
      // A package loaded on first use counts too (sharp, in @circi/diff): `import("…")` outside a
      // comment (JSDoc types say `import("fastify").…`).
      for (const m of code.matchAll(
        /^(?!\s*(?:\*|\/\/|\/\*)).*?\bimport\(\s*"([^"./][^"]*)"\s*\)/gm,
      )) {
        if (!OPTIONAL.has(m[1]!)) specifiers.add(m[1]!)
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

  it("doesn't hold main.mjs open with a top-level await while lazy chunks import it back", () => {
    // Lazily imported chunks (better-auth's permission check among them) import main.mjs for the
    // code they share. A top-level await in main.mjs on the CLI would deadlock such an import
    // ("unsettled top-level await", exit 13): issuing a CI token hung that way.
    const chunks = readdirSync(out).filter((f) => f.endsWith('.mjs') && f !== 'main.mjs')
    const importsMain = chunks.filter((f) =>
      /^(?:import|export)\b[^;]*"\.\/main\.mjs";$/m.test(readFileSync(join(out, f), 'utf8')),
    )
    expect(importsMain.length).toBeGreaterThan(0)
    expect(readFileSync(join(out, 'main.mjs'), 'utf8')).not.toMatch(/^await /m)
  })

  it('ships the js-workers thread script next to main.mjs, standing on its own (no main.mjs import, no top-level await)', () => {
    const code = readFileSync(join(out, 'pool-worker.mjs'), 'utf8')
    expect(code).not.toMatch(/from "\.\/main\.mjs"/)
    expect(code).not.toMatch(/^await /m)
  })

  it('has source maps that lead to our TypeScript, one level above the bundle (/app/apps/... in the image)', () => {
    const map: { sources: string[] } = JSON.parse(readFileSync(join(out, 'main.mjs.map'), 'utf8'))
    const ours = map.sources.filter((s) => !s.includes('node_modules'))
    expect(ours).toContain('../apps/server/src/main.ts')
    expect(ours).toContain('../packages/db/src/client.ts')
    // Besides the TypeScript, the server's package.json: the version (src/version.ts) is read from it.
    const ourFile = /^\.\.\/(apps|packages)\/[^/]+\/(src\/.+\.ts|package\.json)$/
    expect(ours.filter((s) => !ourFile.test(s))).toEqual([])
  })
})
