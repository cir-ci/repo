import { describe, expect, it } from 'vitest'

import { validateBuildSearch } from '../../../src/features/builds/search.ts'
import {
  isHandledElsewhere,
  SHORTCUTS,
  shortcutFor,
} from '../../../src/features/builds/shortcuts.ts'

describe('shortcutFor', () => {
  it('maps the review keys to actions', () => {
    expect(shortcutFor('j')?.action).toEqual({ type: 'next' })
    expect(shortcutFor('k')?.action).toEqual({ type: 'previous' })
    expect(shortcutFor('a')?.action).toEqual({ type: 'approve' })
    expect(shortcutFor('r')?.action).toEqual({ type: 'reject' })
    expect(shortcutFor('?')?.action).toEqual({ type: 'help' })
  })

  it('maps 1 to 4 to the view modes in order', () => {
    expect(['1', '2', '3', '4'].map((k) => shortcutFor(k)?.action)).toEqual([
      { type: 'mode', mode: 'side' },
      { type: 'mode', mode: 'overlay' },
      { type: 'mode', mode: 'diff' },
      { type: 'mode', mode: 'swipe' },
    ])
  })

  it('ignores other keys and lists each key once', () => {
    expect(shortcutFor('x')).toBeUndefined()
    expect(new Set(SHORTCUTS.map((s) => s.key)).size).toBe(SHORTCUTS.length)
  })
})

describe('isHandledElsewhere', () => {
  it('leaves keys with a modifier to the browser', () => {
    expect(isHandledElsewhere(null, { metaKey: true, ctrlKey: false, altKey: false })).toBe(true)
    expect(isHandledElsewhere(null, { metaKey: false, ctrlKey: true, altKey: false })).toBe(true)
    expect(isHandledElsewhere(null, { metaKey: false, ctrlKey: false, altKey: true })).toBe(true)
  })
})

describe('validateBuildSearch', () => {
  it('keeps a screenshot name and a known mode', () => {
    expect(validateBuildSearch({ shot: 'login', mode: 'swipe' })).toEqual({
      shot: 'login',
      mode: 'swipe',
    })
  })

  it('drops anything else', () => {
    expect(validateBuildSearch({ shot: '', mode: 'wiggle' })).toEqual({})
    expect(validateBuildSearch({ shot: 3, mode: 2 })).toEqual({})
  })
})
