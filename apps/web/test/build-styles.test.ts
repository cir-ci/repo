import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { COLOR_SCHEME_ATTRIBUTE, tokenVariables } from '@circi/ui/theme'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Builds the dashboard (the production build the server and the Docker image serve) and checks the
// styles are in it. A side-effect-only `import './global.css'` inside @circi/ui was once dropped by
// the bundler, so the build had every component's CSS but no `--circi-*` definitions: an unstyled
// page in Times, which no type check or unit test sees.
const root = join(import.meta.dirname, '..')
const cache = join(root, 'node_modules/.cache')
let out: string
let css: string
let html: string

beforeAll(() => {
  mkdirSync(cache, { recursive: true })
  out = mkdtempSync(join(cache, 'build-styles-'))
  execFileSync('pnpm', ['exec', 'vite', 'build', '--outDir', out, '--logLevel', 'error'], {
    cwd: root,
    stdio: 'pipe',
    // Vitest sets NODE_ENV=test, which would bundle React's development build.
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const assets = join(out, 'assets')
  css = readdirSync(assets)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(assets, f), 'utf8'))
    .join('\n')
  html = readFileSync(join(out, 'index.html'), 'utf8')
}, 120_000)

/** The script and stylesheet files index.html links, as their contents. */
function initial(): Buffer[] {
  return [
    ...new Set(
      [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)].map((m) => m[1]!),
    ),
  ].map((f) => readFileSync(join(out, 'assets', f)))
}

afterAll(() => rmSync(out, { recursive: true, force: true }))

describe('the built dashboard', () => {
  it('defines every token for both colour schemes', () => {
    const attr = COLOR_SCHEME_ATTRIBUTE
    expect(css).toMatch(/:root\{[^}]*--circi-surface-chrome:/)
    expect(css).toMatch(new RegExp(`\\[${attr}=(?:"|)dark(?:"|)\\]\\{[^}]*--circi-surface-chrome:`))
    expect(css).toMatch(
      new RegExp(`\\[${attr}=(?:"|)light(?:"|)\\]\\{[^}]*--circi-surface-chrome:`),
    )
    // The light value is in there verbatim, not only a variable name.
    expect(css).toContain(
      `--circi-surface-chrome:${tokenVariables('light')['--circi-surface-chrome']}`,
    )
  })

  it('defines the font stacks and the base reset', () => {
    expect(css).toMatch(/--circi-font-sans:/)
    expect(css).toMatch(/--circi-font-mono:/)
    expect(css).toMatch(/:where\(body\)\{[^}]*background:var\(--circi-surface-chrome\)/)
  })

  it('draws the loading screen before any script runs: the logo above an empty #root, styled by a linked stylesheet', () => {
    expect(html).toMatch(
      /<div id="circi-boot" class="circi-boot"[^>]*>\s*<img src="\/assets\/[^"]+\.svg" alt="CirCI"[^>]*>\s*<\/div>\s*<div id="root"><\/div>/,
    )
    const linked = [
      ...html.matchAll(/<link rel="stylesheet"[^>]*href="\/assets\/([^"]+\.css)"/g),
    ].map((m) => readFileSync(join(out, 'assets', m[1]!), 'utf8'))
    expect(linked.some((c) => c.includes('.circi-boot{'))).toBe(true)
  })

  it('links the stylesheet that carries them from index.html', () => {
    const linked = [
      ...html.matchAll(/<link rel="stylesheet"[^>]*href="\/assets\/([^"]+\.css)"/g),
    ].map((m) => readFileSync(join(out, 'assets', m[1]!), 'utf8'))
    expect(linked.some((c) => c.includes('--circi-surface-chrome:'))).toBe(true)
  })

  // A first page load on a server without HTTP/2 fetches about six files at a time, so the number
  // of files matters as much as their size. Before the chunk groups (vite.config.ts) it was 143
  // files, 1,086 kB, 371 kB gzip, 90 of them one Lucide icon each; now about 58, 1,064 kB, 349 kB.
  describe('the files index.html loads', () => {
    it('stays under a file budget', () => {
      expect(initial().length).toBeLessThanOrEqual(65)
    })

    it('is no bigger than before the chunk groups', () => {
      const files = initial()
      expect(files.reduce((n, b) => n + b.length, 0)).toBeLessThanOrEqual(1086 * 1024)
      expect(files.reduce((n, b) => n + gzipSync(b).length, 0)).toBeLessThanOrEqual(371 * 1024)
    })

    it('shares the static Lucide icons in one file', () => {
      const chunks = readdirSync(join(out, 'assets')).filter((f) => /^icons-.*\.js$/.test(f))
      expect(chunks).toHaveLength(1)
      expect(html).toContain(`/assets/${chunks[0]}`)
    })

    it('keeps the project icon loaders in a lazy chunk of a sensible size', () => {
      const glyph = readdirSync(join(out, 'assets')).filter((f) => /^ProjectGlyph-.*\.js$/.test(f))
      expect(glyph).toHaveLength(1)
      expect(html).not.toContain(glyph[0]!)
      // 267 kB (60 kB gzip) while its preload table listed every icon's dependencies.
      expect(readFileSync(join(out, 'assets', glyph[0]!)).length).toBeLessThan(170 * 1024)
    })
  })
})
