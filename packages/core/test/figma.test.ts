import { describe, expect, it } from 'vitest'

import {
  figmaFrameUrl,
  globMatches,
  matchFramesToSnapshots,
  parseFigmaFileRef,
  parseFigmaUrl,
  pickFigmaLink,
} from '#src/index.ts'

describe('parseFigmaUrl', () => {
  it('reads the file key and turns node-id 12-34 into 12:34', () => {
    expect(
      parseFigmaUrl('https://www.figma.com/design/AbC123xyz9Q/Checkout-v3?node-id=12-34&t=zz'),
    ).toEqual({ fileKey: 'AbC123xyz9Q', nodeId: '12:34' })
  })

  it('accepts the encoded colon, the old /file/ form and no node', () => {
    expect(parseFigmaUrl('https://figma.com/file/AbC123xyz9Q/x?node-id=1%3A2')).toEqual({
      fileKey: 'AbC123xyz9Q',
      nodeId: '1:2',
    })
    expect(parseFigmaUrl('https://www.figma.com/design/AbC123xyz9Q')).toEqual({
      fileKey: 'AbC123xyz9Q',
      nodeId: null,
    })
  })

  it('uses the branch key for a branch address', () => {
    expect(
      parseFigmaUrl('https://www.figma.com/design/AbC123xyz9Q/branch/Br4nchKey99/Name?node-id=5-6'),
    ).toEqual({ fileKey: 'Br4nchKey99', nodeId: '5:6' })
  })

  it('rejects other hosts, other paths and a malformed node', () => {
    expect(parseFigmaUrl('https://evil.example/design/AbC123xyz9Q/x')).toBeUndefined()
    expect(parseFigmaUrl('https://www.figma.com/community/file/1')).toBeUndefined()
    expect(parseFigmaUrl('https://www.figma.com/design/AbC123xyz9Q/x?node-id=abc')).toBeUndefined()
    expect(parseFigmaUrl('not a url')).toBeUndefined()
  })

  it('takes a bare key or an address as a file reference', () => {
    expect(parseFigmaFileRef('  AbC123xyz9Q ')).toBe('AbC123xyz9Q')
    expect(parseFigmaFileRef('https://www.figma.com/design/AbC123xyz9Q/x')).toBe('AbC123xyz9Q')
    expect(parseFigmaFileRef('hello')).toBeUndefined()
  })

  it('writes an address back', () => {
    expect(figmaFrameUrl('AbC123xyz9Q', '12:34')).toBe(
      'https://www.figma.com/design/AbC123xyz9Q?node-id=12-34',
    )
    expect(parseFigmaUrl(figmaFrameUrl('AbC123xyz9Q', '12:34'))?.nodeId).toBe('12:34')
  })
})

const pairs = (frames: string[], snaps: string[]) =>
  matchFramesToSnapshots(frames, snaps).map((m) => [m.snapshotName, frames[m.frameIndex]])

describe('matchFramesToSnapshots', () => {
  it('matches whole names ignoring case and separators', () => {
    expect(
      pairs(['Checkout / Cart', 'Home Page'], ['checkout-cart', 'home_page', 'other']),
    ).toEqual([
      ['checkout-cart', 'Checkout / Cart'],
      ['home_page', 'Home Page'],
    ])
  })

  it('falls back to the last path segment', () => {
    expect(pairs(['Cart', 'Login'], ['checkout/cart', 'auth/login-form'])).toEqual([
      ['checkout/cart', 'Cart'],
    ])
  })

  it('prefers an exact match over a segment match for the same frame', () => {
    expect(pairs(['Cart'], ['cart', 'checkout/cart'])).toEqual([['cart', 'Cart']])
  })

  it('never links when two frames match equally', () => {
    expect(pairs(['Cart', 'cart'], ['cart'])).toEqual([])
    expect(pairs(['Cart', 'CART'], ['checkout/cart'])).toEqual([])
  })

  it('never links a frame two snapshots claim by their last segment', () => {
    expect(pairs(['Button'], ['a/button', 'b/button'])).toEqual([])
  })

  it('never links two snapshots that normalise to one frame', () => {
    expect(pairs(['Home Page'], ['home-page', 'home_page'])).toEqual([])
  })

  it('ignores empty names', () => {
    expect(pairs(['', '  '], ['', '/'])).toEqual([])
  })
})

describe('pickFigmaLink', () => {
  it('prefers manual, then the more specific pattern', () => {
    const links = [
      { snapshotPattern: 'checkout/*', source: 'manual', id: 'wild' },
      { snapshotPattern: 'checkout/cart', source: 'auto', id: 'auto' },
      { snapshotPattern: 'checkout/cart', source: 'manual', id: 'exact' },
    ]
    expect(pickFigmaLink(links, 'checkout/cart', globMatches)?.id).toBe('exact')
    expect(pickFigmaLink(links, 'checkout/pay', globMatches)?.id).toBe('wild')
    expect(pickFigmaLink(links, 'home', globMatches)).toBeUndefined()
  })
})
