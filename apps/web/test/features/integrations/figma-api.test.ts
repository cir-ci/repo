import { describe, expect, it } from 'vitest'

import {
  autoLinkSummary,
  isFigmaToken,
  isFileReference,
  isFrameAddress,
  linkedLabel,
} from '#features/integrations/figma-api.ts'

describe('Figma page logic', () => {
  it('accepts a token that looks pasted whole, trimmed', () => {
    expect(isFigmaToken('  figd_abcdefgh  ')).toBe(true)
    expect(isFigmaToken('figd')).toBe(false)
    expect(isFigmaToken('   ')).toBe(false)
  })

  it('tells a frame address from a file address', () => {
    const file = 'https://www.figma.com/design/AbC123xyz9Q/Checkout'
    expect(isFileReference(file)).toBe(true)
    expect(isFileReference('AbC123xyz9Q')).toBe(true)
    expect(isFileReference('hello')).toBe(false)
    expect(isFrameAddress(file)).toBe(false)
    expect(isFrameAddress(`${file}?node-id=12-34`)).toBe(true)
    expect(isFrameAddress('https://example.com/design/AbC123xyz9Q/x?node-id=1-2')).toBe(false)
  })

  it('words how many frames are linked', () => {
    expect(linkedLabel({ linked: 0, frameCount: 47 })).toBe('No frames linked')
    expect(linkedLabel({ linked: 3, frameCount: 47 })).toBe('3 of 47 frames linked')
    expect(linkedLabel({ linked: 1, frameCount: null })).toBe('1 frame linked')
  })

  it('summarises an automatic run', () => {
    expect(autoLinkSummary({ created: 2, unlinked: 0, frames: 5 })).toBe(
      'Linked 2 snapshots to frames.',
    )
    expect(autoLinkSummary({ created: 0, unlinked: 3, frames: 5 })).toBe(
      'No new frames linked; 3 snapshots have no frame with a matching name.',
    )
    expect(autoLinkSummary({ created: 1, unlinked: 1, frames: 1 })).toBe(
      'Linked 1 snapshot to frames; 1 snapshot has no frame with a matching name.',
    )
  })
})
