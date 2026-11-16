import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleKeydown } from '#lib/shortcuts.ts'
import { useShortcutStore } from '#lib/stores/shortcut-store.ts'
import { useSingleKeyStore } from '#lib/stores/single-key-store.ts'

afterEach(() => {
  useSingleKeyStore.getState().setEnabled(true)
  useShortcutStore.getState().reset()
  document.body.replaceChildren()
})

function press(init: KeyboardEventInit, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  // `handleKeydown` reads `event.target`, which is only set while dispatching.
  Object.defineProperty(event, 'target', { value: target })
  handleKeydown(event)
}

function bindApproveAll() {
  const approveAll = vi.fn<() => void>()
  const reject = vi.fn<() => void>()
  const approve = vi.fn<() => void>()
  useShortcutStore.getState().bind({ current: { approveAll, reject, approve } })
  return { approveAll, reject, approve }
}

const add = (html: string) => {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  const el = host.firstElementChild
  if (!(el instanceof HTMLElement)) throw new Error('no element')
  return el
}

describe('shortcuts and text fields', () => {
  it('fires from the page', () => {
    const { approveAll } = bindApproveAll()
    press({ key: 'A', shiftKey: true })
    expect(approveAll).toHaveBeenCalledOnce()
  })

  it.each([
    ['an input', '<input />'],
    ['a textarea', '<textarea></textarea>'],
    ['a select', '<select><option>x</option></select>'],
    ['a contenteditable', '<div contenteditable="true"></div>'],
    ['a bare contenteditable', '<div contenteditable=""></div>'],
    ['a plaintext-only contenteditable', '<div contenteditable="plaintext-only"></div>'],
    ['a textbox role', '<div role="textbox" tabindex="0"></div>'],
    ['a combobox role', '<div role="combobox" tabindex="0"></div>'],
  ])('never fires a destructive shortcut from %s', (_name, html) => {
    const { approveAll, reject, approve } = bindApproveAll()
    const field = add(html)
    press({ key: 'A', shiftKey: true }, field)
    press({ key: 'R' }, field)
    press({ key: 'a' }, field)
    expect(approveAll).not.toHaveBeenCalled()
    expect(reject).not.toHaveBeenCalled()
    expect(approve).not.toHaveBeenCalled()
  })

  it('looks at the focused element when the key was sent to the window', () => {
    const { approveAll } = bindApproveAll()
    const field = add('<textarea></textarea>')
    field.focus()
    press({ key: 'A', shiftKey: true }, window)
    expect(approveAll).not.toHaveBeenCalled()
  })

  it('stays quiet while a reply or comment box is open with text, wherever focus is', () => {
    const { approveAll } = bindApproveAll()
    useShortcutStore.getState().setDrafting('reply-1', true)
    press({ key: 'A', shiftKey: true })
    expect(approveAll).not.toHaveBeenCalled()
    // Closing or emptying the box gives the keys back.
    useShortcutStore.getState().setDrafting('reply-1', false)
    press({ key: 'A', shiftKey: true })
    expect(approveAll).toHaveBeenCalledOnce()
  })

  it('still lets a ⌘ shortcut through while drafting', () => {
    const command = vi.fn<() => void>()
    useShortcutStore.getState().bind({ current: { command } })
    useShortcutStore.getState().setDrafting('c', true)
    press({ key: 'k', metaKey: true })
    expect(command).toHaveBeenCalledOnce()
  })
})

describe('shortcuts and sliders', () => {
  const slider = '<input type="range" />'

  it('ignores single-key shortcuts from any slider', () => {
    const { approve } = bindApproveAll()
    const diffLayer = vi.fn<() => void>()
    useShortcutStore.getState().bind({ current: { diffLayer } })
    const field = add(slider)
    press({ key: 'a' }, field)
    press({ key: '[' }, field)
    expect(approve).not.toHaveBeenCalled()
    expect(diffLayer).not.toHaveBeenCalled()
  })

  it('lets [ and ] through from the Diff layer slider only, and nothing else', () => {
    const { approve } = bindApproveAll()
    const diffLayer = vi.fn<() => void>()
    useShortcutStore.getState().bind({ current: { diffLayer } })
    const field = add(`<div data-diff-layer>${slider}</div>`).querySelector('input')
    if (!field) throw new Error('no slider')
    press({ key: ']' }, field)
    expect(diffLayer).toHaveBeenCalledOnce()
    press({ key: 'a' }, field)
    expect(approve).not.toHaveBeenCalled()
  })
})

describe('the single-key shortcuts preference', () => {
  it('off, keeps only the shortcuts with a modifier', () => {
    const { approve } = bindApproveAll()
    const command = vi.fn<() => void>()
    useShortcutStore.getState().bind({ current: { command } })
    useSingleKeyStore.getState().setEnabled(false)
    press({ key: 'a' })
    press({ key: 'A', shiftKey: true })
    expect(approve).not.toHaveBeenCalled()
    press({ key: 'k', metaKey: true })
    expect(command).toHaveBeenCalledOnce()
    useSingleKeyStore.getState().setEnabled(true)
    press({ key: 'a' })
    expect(approve).toHaveBeenCalledOnce()
  })
})
