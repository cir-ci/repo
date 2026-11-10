import { describe, expect, it } from 'vitest'

import { documentTitle } from '#lib/document-title.ts'

describe('documentTitle', () => {
  it('ends with CirCI in a browser tab', () => {
    expect(documentTitle(['Build #2', undefined, 'web-app'], false)).toBe(
      'Build #2 · web-app · CirCI',
    )
  })

  it('leaves CirCI out in the installed app, whose window already says so', () => {
    expect(documentTitle(['Build #2', 'web-app'], true)).toBe('Build #2 · web-app')
  })

  it('keeps CirCI when there is nothing else to say', () => {
    expect(documentTitle([], true)).toBe('CirCI')
    expect(documentTitle([undefined], false)).toBe('CirCI')
  })
})
