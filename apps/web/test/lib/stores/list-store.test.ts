import { beforeEach, describe, expect, it } from 'vitest'

import { useListStore } from '#lib/stores/list-store.ts'

beforeEach(() => useListStore.getState().reset())

describe('the list store', () => {
  it('moves the cursor and toggles the preview', () => {
    const s = useListStore.getState()
    s.setCursorId('b1')
    s.togglePeek()
    expect(useListStore.getState()).toMatchObject({ cursorId: 'b1', peek: true })
    s.togglePeek()
    expect(useListStore.getState().peek).toBe(false)
  })

  it('ticks and unticks rows, and says which it did', () => {
    const s = useListStore.getState()
    expect(s.toggleChecked('a')).toBe(true)
    expect(s.toggleChecked('b')).toBe(true)
    expect(s.toggleChecked('a')).toBe(false)
    expect([...useListStore.getState().checked]).toEqual(['b'])
    s.clearChecked()
    expect(useListStore.getState().checked.size).toBe(0)
  })

  it('resets to a clean list', () => {
    const s = useListStore.getState()
    s.setCursorId('x')
    s.toggleChecked('x')
    s.reset()
    expect(useListStore.getState()).toMatchObject({ cursorId: undefined, peek: false })
    expect(useListStore.getState().checked.size).toBe(0)
  })
})
