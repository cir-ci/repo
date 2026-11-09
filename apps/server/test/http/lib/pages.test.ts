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
