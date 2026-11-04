import { describe, expect, it } from 'vitest'

import { pairScreenshots } from '../src/index.ts'

const s = (id: string, name: string, fileSha256: string) => ({ id, name, fileSha256 })

describe('pairScreenshots', () => {
  it('classifies added, removed, unchanged and to-compare by name', () => {
    const head = [s('h1', 'home', 'A'), s('h2', 'login', 'B2'), s('h3', 'new-page', 'C')]
    const base = [s('b1', 'home', 'A'), s('b2', 'login', 'B1'), s('b3', 'old-page', 'D')]
    expect(pairScreenshots(head, base).map((p) => [p.name, p.status])).toEqual([
      ['home', 'unchanged'],
      ['login', 'compare'],
      ['new-page', 'added'],
      ['old-page', 'removed'],
    ])
  })

  it('treats every screenshot as added when there is no baseline', () => {
    const pairs = pairScreenshots([s('h1', 'a', 'x'), s('h2', 'b', 'y')], [])
    expect(pairs.every((p) => p.status === 'added')).toBe(true)
  })

  it('keeps the head and base references', () => {
    const [pair] = pairScreenshots([s('h1', 'a', 'x')], [s('b1', 'a', 'y')])
    expect(pair).toEqual({
      status: 'compare',
      name: 'a',
      head: s('h1', 'a', 'x'),
      base: s('b1', 'a', 'y'),
    })
  })
})
