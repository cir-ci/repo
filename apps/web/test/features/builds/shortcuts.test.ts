import { describe, expect, it } from 'vitest'

import { validateBuildSearch } from '#features/builds/search.ts'
import {
  isAvailable,
  isHandledElsewhere,
  isSubmitKey,
  SHORTCUTS,
  shortcutFor,
  shortcutGroups,
} from '#lib/shortcuts.ts'

describe('shortcutFor', () => {
  it('maps the review keys to actions', () => {
    expect(shortcutFor('j')?.action).toEqual({ type: 'next' })
    expect(shortcutFor('k')?.action).toEqual({ type: 'previous' })
    expect(shortcutFor('a')?.action).toEqual({ type: 'approve' })
    expect(shortcutFor('shift+a')?.action).toEqual({ type: 'approveAll' })
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
    expect(shortcutFor('z')).toBeUndefined()
    expect(new Set(SHORTCUTS.map((s) => s.key)).size).toBe(SHORTCUTS.length)
  })
})

const keys = (enabled: boolean) =>
  shortcutGroups(enabled).flatMap((g) => g.shortcuts.map((s) => s.key))

describe('build review keys', () => {
  it('declares comment, request review, submit and the Design mode once each', () => {
    expect(shortcutFor('c')?.action).toEqual({ type: 'comment' })
    expect(shortcutFor('shift+r')?.action).toEqual({ type: 'requestReview' })
    expect(shortcutFor('mod+Enter')?.action).toEqual({ type: 'submit' })
    expect(shortcutFor('5')?.action).toEqual({ type: 'mode', mode: 'design' })
  })

  it('offers the Design mode only when it is enabled', () => {
    const design = shortcutFor('5')
    expect(design && isAvailable(design, false)).toBe(false)
    expect(design && isAvailable(design, true)).toBe(true)
    expect(keys(false)).not.toContain('5')
    expect(keys(true)).toContain('5')
    expect(keys(false)).toEqual(expect.arrayContaining(['c', 'shift+r', 'mod+Enter']))
  })

  it('recognises command-enter and control-enter, not plain enter', () => {
    const e = { key: 'Enter', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }
    expect(isSubmitKey({ ...e, metaKey: true })).toBe(true)
    expect(isSubmitKey({ ...e, ctrlKey: true })).toBe(true)
    expect(isSubmitKey(e)).toBe(false)
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

  it('accepts the Design mode', () => {
    expect(validateBuildSearch({ mode: 'design' })).toEqual({ mode: 'design' })
  })
})
