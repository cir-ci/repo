import { describe, expect, it } from 'vitest'

import { GROUP_ORDER, keyCaps, keyToken, SHORTCUTS, shortcutGroups } from '#lib/shortcuts.ts'
import { stepIndex } from '#lib/use-list-navigation.ts'

describe('the shortcut registry', () => {
  it('has no key twice in the same scope', () => {
    const seen = new Set<string>()
    for (const s of SHORTCUTS) {
      const id = `${s.scope}:${s.key}`
      expect(seen.has(id)).toBe(false)
      seen.add(id)
    }
  })

  it('calls the space key "Peek at the item"', () => {
    expect(SHORTCUTS.find((s) => s.action.type === 'peek')?.description).toBe('Peek at the item')
    expect(SHORTCUTS.some((s) => /preview/i.test(s.description))).toBe(false)
  })

  it('describes and groups every entry', () => {
    for (const s of SHORTCUTS) {
      expect(s.description.trim()).not.toBe('')
      expect(s.group).toBeTruthy()
    }
  })

  it('lists every entry in the help groups', () => {
    // The Design mode key is listed only once the integration is on.
    // The tab keys only in the installed app, and ⌥2 to ⌥9 stand under the one row for ⌥1.
    const listed = shortcutGroups(true, true).flatMap((g) => g.shortcuts)
    expect(listed).toHaveLength(SHORTCUTS.filter((s) => s.listed !== false).length)
    const plain = SHORTCUTS.filter((s) => !s.installed && s.listed !== false).length
    expect(shortcutGroups(false, false).flatMap((g) => g.shortcuts)).toHaveLength(plain - 1)
  })

  it('puts every shortcut in exactly one group, in the page order', () => {
    const groups = shortcutGroups(true, true)
    const keys = groups.flatMap((g) => g.shortcuts.map((s) => `${s.scope}:${s.key}`))
    const expected = SHORTCUTS.filter((s) => s.listed !== false)
    expect(keys.toSorted()).toEqual(expected.map((s) => `${s.scope}:${s.key}`).toSorted())
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(groups.map((g) => g.group)).size).toBe(groups.length)
    // Every group a shortcut names is in the order, and the order lists nothing else.
    expect(GROUP_ORDER.toSorted()).toEqual([...new Set(SHORTCUTS.map((s) => s.group))].toSorted())
    expect(groups.map((g) => g.group)).toEqual(GROUP_ORDER)
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

  it('names an Alt press by its physical key, for letters, digits and the arrows only', () => {
    expect(press('†', { altKey: true, code: 'KeyT' })).toBe('alt+t')
    expect(press('¡', { altKey: true, code: 'Digit1' })).toBe('alt+1')
    expect(press('ArrowLeft', { altKey: true, shiftKey: true, code: 'ArrowLeft' })).toBe(
      'alt+shift+ArrowLeft',
    )
    expect(press('j', { altKey: true })).toBeUndefined()
    expect(press('Enter', { altKey: true, code: 'Enter' })).toBeUndefined()
    expect(press('t', { altKey: true, metaKey: true, code: 'KeyT' })).toBeUndefined()
  })

  it('names [ and ] with or without Option, by the character or the physical bracket key', () => {
    expect(press('[')).toBe('[')
    // A layout that types [ with Option (German: Option+5).
    expect(press('[', { altKey: true, code: 'Digit5' })).toBe('[')
    expect(press(']', { altKey: true, code: 'Digit6' })).toBe(']')
    // Option changes what the bracket keys type (US layout): still the bracket.
    expect(press('\u201c', { altKey: true, code: 'BracketLeft' })).toBe('[')
    expect(press('\u2018', { altKey: true, code: 'BracketRight' })).toBe(']')
  })

  it('draws the tab keys', () => {
    expect(keyCaps('alt+shift+ArrowLeft')).toEqual(['⌥', '⇧', '←'])
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
    const listed = shortcutGroups(true, true).flatMap((g) =>
      g.shortcuts.map((s) => `${s.scope}:${s.key}`),
    )
    const expected = SHORTCUTS.filter((s) => s.listed !== false)
    expect(listed.toSorted()).toEqual(expected.map((s) => `${s.scope}:${s.key}`).toSorted())
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
