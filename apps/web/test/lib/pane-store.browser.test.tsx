import { describe, expect, it, vi } from 'vitest'

import { PANES, PANE_IDS, paneWidth } from '#lib/panes.ts'
import { PANES_KEY, usePaneStore } from '#lib/stores/pane-store.ts'

const stored = () => JSON.parse(localStorage.getItem(PANES_KEY) ?? 'null')?.state

describe('paneWidth', () => {
  it('falls back to the default and holds a value to the pane range', () => {
    expect(paneWidth('sidebar', undefined)).toBe(244)
    expect(paneWidth('sidebar', 'wide')).toBe(244)
    expect(paneWidth('sidebar', 50)).toBe(200)
    expect(paneWidth('sidebar', 9000)).toBe(360)
    expect(paneWidth('sidebar', 250.4)).toBe(250)
  })

  it('has a default inside its range for every pane', () => {
    for (const id of PANE_IDS) {
      const { default: d, min, max } = PANES[id]
      expect(min).toBeLessThanOrEqual(d)
      expect(d).toBeLessThanOrEqual(max)
    }
  })
})

describe('pane store', () => {
  it('starts at the defaults with nothing collapsed', () => {
    const s = usePaneStore.getState()
    expect(s.widths).toEqual({})
    expect(s.collapsed).toEqual({ sidebar: false, 'settings-nav': false })
  })

  it('keeps a width per pane, held to its range, and writes it to localStorage', () => {
    usePaneStore.getState().setWidth('build-rail', 300)
    usePaneStore.getState().setWidth('inbox-pane', 5000)
    expect(usePaneStore.getState().widths).toEqual({ 'build-rail': 300, 'inbox-pane': 720 })
    expect(stored().widths).toEqual({ 'build-rail': 300, 'inbox-pane': 720 })
  })

  it('resets one pane to its default', () => {
    usePaneStore.getState().setWidth('build-rail', 300)
    usePaneStore.getState().setWidth('sidebar', 300)
    usePaneStore.getState().resetWidth('build-rail')
    expect(usePaneStore.getState().widths).toEqual({ sidebar: 300 })
  })

  it('remembers collapsing the sidebar and the settings navigation separately', () => {
    usePaneStore.getState().setCollapsed('sidebar', true)
    expect(stored().collapsed).toEqual({ sidebar: true, 'settings-nav': false })
    usePaneStore.getState().setCollapsed('settings-nav', true)
    expect(stored().collapsed).toEqual({ sidebar: true, 'settings-nav': true })
  })

  it('restores what was stored, holding stale widths to today range and ignoring junk', async () => {
    localStorage.setItem(
      PANES_KEY,
      JSON.stringify({
        state: {
          widths: { sidebar: 100, 'build-rail': 333, 'reviews-list': 'x', gone: 5 },
          collapsed: { sidebar: true, 'settings-nav': 'yes' },
        },
        version: 0,
      }),
    )
    await usePaneStore.persist.rehydrate()
    expect(usePaneStore.getState().widths).toEqual({ sidebar: 200, 'build-rail': 333 })
    expect(usePaneStore.getState().collapsed).toEqual({ sidebar: true, 'settings-nav': false })
  })

  it('starts from the defaults when the stored value is not JSON', async () => {
    localStorage.setItem(PANES_KEY, '{nope')
    await usePaneStore.persist.rehydrate()
    expect(usePaneStore.getState().widths).toEqual({})
  })

  it('still works for this visit when storage throws', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    await usePaneStore.persist.rehydrate()
    usePaneStore.getState().setWidth('sidebar', 300)
    usePaneStore.getState().setCollapsed('sidebar', true)
    expect(usePaneStore.getState().widths.sidebar).toBe(300)
    expect(usePaneStore.getState().collapsed.sidebar).toBe(true)
    get.mockRestore()
    set.mockRestore()
  })
})
