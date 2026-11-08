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
    // The Design mode key is listed only once the integration is on.
    const listed = shortcutGroups(true).flatMap((g) => g.shortcuts)
    expect(listed).toHaveLength(SHORTCUTS.length)
    expect(shortcutGroups().flatMap((g) => g.shortcuts)).toHaveLength(SHORTCUTS.length - 1)
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
    expect(press(' ')).toBe('space')
    expect(press('R', { shiftKey: true })).toBe('shift+r')
  })

  it('never names an Alt press', () => {
    expect(press('j', { altKey: true })).toBeUndefined()
  })
})

describe('the list shortcuts', () => {
  it('declares open, peek, snooze, request review, read and delete', () => {
    const keys = SHORTCUTS.map((s) => s.key)
    expect(keys).toEqual(
      expect.arrayContaining(['Enter', 'space', 'h', 'shift+r', 'u', 'Backspace']),
    )
    expect(SHORTCUTS.find((s) => s.key === 'u')?.scope).toBe('inbox')
  })
})

describe('keyCaps', () => {
  it('draws caps for a key spec', () => {
    expect(keyCaps('mod+shift+c')).toEqual(['⌘', '⇧', 'C'])
    expect(keyCaps('g i')).toEqual(['G', 'I'])
    expect(keyCaps('?')).toEqual(['?'])
    expect(keyCaps('Enter')).toEqual(['↵'])
    expect(keyCaps('Backspace')).toEqual(['⌫'])
    expect(keyCaps('space')).toEqual(['Space'])
    expect(keyCaps('shift+r')).toEqual(['⇧', 'R'])
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

describe('the help and the command menu', () => {
  it('lists every shortcut, with its description, under a group', () => {
    const listed = shortcutGroups(true).flatMap((g) =>
      g.shortcuts.map((s) => `${s.scope}:${s.key}`),
    )
    expect(listed.toSorted()).toEqual(SHORTCUTS.map((s) => `${s.scope}:${s.key}`).toSorted())
  })

  it('declares ⌘K and ? with a description and a group', () => {
    for (const key of ['mod+k', '?']) {
      const s = SHORTCUTS.find((x) => x.key === key)
      expect(s?.scope).toBe('global')
      expect(s?.description).not.toBe('')
      expect(shortcutGroups().some((g) => g.shortcuts.includes(s!))).toBe(true)
    }
  })
})
