import { describe, expect, it } from 'vitest'

import { extractCode, extractLinks } from '#clients/mail.ts'

describe('mail extraction', () => {
  it('finds the six-digit code, not a longer number or a colour', () => {
    expect(
      extractCode({ Text: 'Order 1234567 and #123456 colour. Your code: 482913', HTML: '' }),
    ).toBe('482913')
    expect(() => extractCode({ Text: 'no code 12345', HTML: '' })).toThrow(/No 6-digit code/)
  })

  it('lists links from HTML and text once, decoding &amp;', () => {
    const links = extractLinks({
      Text: 'open http://localhost:3000/accept?x=1&y=2 now.',
      HTML: '<a href="http://localhost:3000/accept?x=1&amp;y=2">go</a> <a href="https://other.test/z">z</a>',
    })
    expect(links).toEqual(['http://localhost:3000/accept?x=1&y=2', 'https://other.test/z'])
  })
})
