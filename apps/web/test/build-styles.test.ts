import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

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
  })
  const assets = join(out, 'assets')
  css = readdirSync(assets)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(assets, f), 'utf8'))
    .join('\n')
  html = readFileSync(join(out, 'index.html'), 'utf8')
}, 120_000)

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

  it('draws the loading screen before any script runs: the logo in #root, styled by a linked stylesheet', () => {
    expect(html).toMatch(
      /<div id="root">\s*<div class="circi-boot"[^>]*>\s*<img src="\/assets\/[^"]+\.svg" alt="CirCI"/,
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
})
