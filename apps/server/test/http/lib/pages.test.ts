import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { monoFont, sansFont, tokenVariables } from '@circi/ui/theme'
import { describe, expect, it } from 'vitest'

import { noticePage, PAGE_CSP, standalonePage } from '#http/lib/pages.ts'

describe('noticePage', () => {
  it('escapes the title and keeps the body’s own markup', () => {
    const html = noticePage('<script>alert(1)</script> & "x"', 'Run <code>pnpm build</code>.')
    expect(html).not.toContain('<script>')
    expect(html).toContain('<h1>&#60;script&#62;alert(1)&#60;/script&#62; &#38; &#34;x&#34;</h1>')
    expect(html).toContain('<title>&#60;script&#62;')
    expect(html).toContain('Run <code>pnpm build</code>.')
  })

  it('is one self-contained page: inline style and logo, no request to anything', () => {
    const html = standalonePage('Site not found', 'Gone.')
    expect(html).toContain('<svg')
    expect(html).toContain('Self-hosted CirCI')
    expect(html).not.toMatch(/<(script|link|img|iframe)\b|src=|href=|url\(|@import/)
    expect(PAGE_CSP).toContain("default-src 'none'")
  })
})

const style = (html: string) => /<style>([\s\S]*)<\/style>/.exec(html)?.[1] ?? ''
const cssFile = readFileSync(
  new URL('../../../src/http/lib/standalone-page.css', import.meta.url),
  'utf8',
)

describe('the pages’ stylesheet', () => {
  const css = style(standalonePage('Site not found', 'Gone.'))
  const [light, dark] = css.split('@media (prefers-color-scheme: dark)')

  it('defines the theme’s own values for the variables it uses, light then dark', () => {
    const used = new Set(cssFile.match(/--circi-[\w-]+/g))
    expect(used.size).toBeGreaterThan(5)
    for (const [scheme, block] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      const vars = tokenVariables(scheme)
      for (const name of used) {
        if (name === '--circi-font-sans' || name === '--circi-font-mono') continue
        expect(block, `${scheme} ${name}`).toContain(`${name}: ${vars[name]};`)
      }
    }
    expect(css).toContain(`--circi-font-sans: ${sansFont};`)
    expect(css).toContain(`--circi-font-mono: ${monoFont};`)
  })

  it('has no colour of its own in the file: hex values only come from the generated blocks', () => {
    expect(cssFile).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
    expect(css.slice(css.indexOf(cssFile))).toBe(cssFile)
  })

  it('is allowed by the CSP through its hash, and nothing else is', () => {
    const hash = createHash('sha256')
      .update(style(standalonePage('x', 'y')))
      .digest('base64')
    expect(PAGE_CSP).toContain(`style-src 'sha256-${hash}'`)
  })

  it('requests nothing', () => {
    expect(css).not.toMatch(/url\(|@import/)
  })
})
