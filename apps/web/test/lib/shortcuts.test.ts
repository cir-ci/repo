import { describe, expect, it } from 'vitest'

import { keyCaps, keyToken, SHORTCUTS, shortcutGroups } from '../../src/lib/shortcuts.ts'
import { stepIndex } from '../../src/lib/use-list-navigation.ts'

describe('the shortcut registry', () => {
  it('has no key twice in the same scope', () => {
    const seen = new Set<string>()
    for (const s of SHORTCUTS) {
      const id = `${s.scope}:${s.key}`
      expect(seen.has(id)).toBe(false)
      seen.add(id)
    }
  })

  it('describes and groups every entry', () => {
    for (const s of SHORTCUTS) {
      expect(s.description.trim()).not.toBe('')
      expect(s.group).toBeTruthy()
    }
  })

  it('lists every entry in the help groups', () => {
    const listed = shortcutGroups().flatMap((g) => g.shortcuts)
    expect(listed).toHaveLength(SHORTCUTS.length)
  })

  it('declares the global keys', () => {
    const global = SHORTCUTS.filter((s) => s.scope === 'global').map((s) => s.key)
    expect(global).toEqual(
      expect.arrayContaining(['g i', 'g r', 'g p', 'g t', 'g s', '?', 'mod+k', 'mod+shift+c']),
    )
  })
})

const press = (key: string, over: Partial<KeyboardEvent> = {}) =>
  keyToken({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over })

describe('keyToken', () => {
  it('names plain, shifted and modified presses', () => {
    expect(press('j')).toBe('j')
    expect(press('?', { shiftKey: true })).toBe('?')
    expect(press('A', { shiftKey: true })).toBe('shift+a')
    expect(press('k', { metaKey: true })).toBe('mod+k')
    expect(press('C', { ctrlKey: true, shiftKey: true })).toBe('mod+shift+c')
    expect(press('Escape')).toBe('Escape')
  })

  it('never names an Alt press', () => {
    expect(press('j', { altKey: true })).toBeUndefined()
  })
})

describe('keyCaps', () => {
  it('draws caps for a key spec', () => {
    expect(keyCaps('mod+shift+c')).toEqual(['⌘', '⇧', 'C'])
    expect(keyCaps('g i')).toEqual(['G', 'I'])
    expect(keyCaps('?')).toEqual(['?'])
  })
})

describe('stepIndex', () => {
  it('steps and stops at the ends', () => {
    expect(stepIndex(3, 0, 1)).toBe(1)
    expect(stepIndex(3, 2, 1)).toBe(2)
    expect(stepIndex(3, 0, -1)).toBe(0)
    expect(stepIndex(3, 2, -1)).toBe(1)
  })
  it('starts at the first (j) or last (k) when nothing is selected', () => {
    expect(stepIndex(3, -1, 1)).toBe(0)
    expect(stepIndex(3, -1, -1)).toBe(2)
  })
  it('does nothing for an empty list', () => {
    expect(stepIndex(0, -1, 1)).toBeUndefined()
  })
})
