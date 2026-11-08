import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleKeydown } from '#lib/shortcuts.ts'
import { useShortcutStore } from '#lib/stores/shortcut-store.ts'

beforeEach(() => {
  // Node has no DOM: a key press target is never an element here.
  vi.stubGlobal('Element', function Element() {})
  useShortcutStore.getState().reset()
})
afterEach(() => vi.unstubAllGlobals())

// Node has no KeyboardEvent: the handler reads only these fields.
const press = (key: string, now?: number) =>
  handleKeydown(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    {
      key,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      target: null,
      preventDefault() {},
    } as KeyboardEvent,
    now,
  )

describe('the shortcut store', () => {
  it('stacks bindings and unbinds the one it returned', () => {
    const { bind } = useShortcutStore.getState()
    const a = { current: {} }
    const b = { current: {} }
    const unbindA = bind(a)
    bind(b)
    expect(useShortcutStore.getState().bindings).toEqual([a, b])
    unbindA()
    expect(useShortcutStore.getState().bindings).toEqual([b])
  })

  it('runs the newest binding of an action', () => {
    const older = vi.fn<() => void>()
    const newer = vi.fn<() => void>()
    const { bind } = useShortcutStore.getState()
    bind({ current: { next: older } })
    const unbind = bind({ current: { next: newer } })
    press('j')
    expect(newer).toHaveBeenCalledTimes(1)
    expect(older).not.toHaveBeenCalled()
    unbind()
    press('j')
    expect(older).toHaveBeenCalledTimes(1)
  })

  it('remembers a chord prefix for a second, and forgets it when it is too late', () => {
    const go = vi.fn<(action: unknown, event: unknown) => void>()
    useShortcutStore.getState().bind({ current: { go } })
    press('g', 0)
    expect(useShortcutStore.getState().pending).toEqual({ prefix: 'g', at: 0 })
    press('i', 500)
    expect(go).toHaveBeenCalledWith({ type: 'go', to: 'inbox' }, expect.anything())
    expect(useShortcutStore.getState().pending).toBeUndefined()
    press('g', 0)
    press('i', 5000)
    expect(go).toHaveBeenCalledTimes(1)
  })
})
