import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { TABS_KEY, useTabStore } from '#lib/stores/tab-store.ts'
import { useToastStore } from '#lib/stores/toast-store.ts'
import { activeTab, hrefOf } from '#lib/tabs.ts'

const store = () => useTabStore.getState()
const stored = () => JSON.parse(localStorage.getItem(TABS_KEY) ?? 'null')
const hrefs = () => store().tabs.map((t) => hrefOf(t))

describe('tab store', () => {
  it('starts with one tab on the page the app opened on, for that person', () => {
    store().adopt('u1', '/acme/web')
    expect(hrefs()).toEqual(['/acme/web'])
    expect(store().owner).toBe('u1')
    expect(stored().owner).toBe('u1')
  })

  it('saves every change and takes the tabs back after a reload', () => {
    store().adopt('u1', '/inbox')
    store().open('/acme/web/triage')
    store().visit('/acme/web/triage?x=1')
    store().togglePin(store().tabs[0]?.id ?? '')
    const before = { tabs: store().tabs, activeId: store().activeId }
    // A reload: the store starts empty and reads what the browser holds.
    store().reset()
    expect(store().tabs).toEqual([])
    store().adopt('u1', '/acme/web/triage?x=1')
    expect({ tabs: store().tabs, activeId: store().activeId }).toEqual(before)
  })

  it('opens a launch address the saved tab is not on as a new page of the active tab', () => {
    store().adopt('u1', '/inbox')
    store().reset()
    store().adopt('u1', '/acme/web/builds/4')
    expect(hrefOf(activeTab(store()))).toBe('/acme/web/builds/4')
    expect(store().tabs).toHaveLength(1)
  })

  it('does not hand one person the tabs of another', () => {
    store().adopt('u1', '/inbox')
    store().open('/reviews')
    store().reset()
    store().adopt('u2', '/inbox')
    expect(store().tabs).toHaveLength(1)
    expect(stored().owner).toBe('u2')
  })

  it('forgets everything on sign-out, in memory and in storage', () => {
    store().adopt('u1', '/inbox')
    store().open('/reviews')
    store().clear()
    expect(store().tabs).toEqual([])
    expect(localStorage.getItem(TABS_KEY)).toBeNull()
  })

  it('keeps working with no storage', () => {
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      store().adopt('u1', '/inbox')
      store().open('/reviews')
      expect(store().tabs).toHaveLength(2)
    } finally {
      blocked.mockRestore()
    }
  })

  it('ignores damaged storage', () => {
    localStorage.setItem(TABS_KEY, '{"owner":"u1","state":42}')
    store().adopt('u1', '/inbox')
    expect(hrefs()).toEqual(['/inbox'])
  })

  it('at 12 tabs opens another by closing the oldest unpinned background tab, and Undo reverts it', async () => {
    store().adopt('u1', '/p0')
    for (let i = 1; i < 12; i++) store().open(`/p${i}`)
    expect(store().tabs).toHaveLength(12)
    store().open('/p12')
    expect(store().tabs).toHaveLength(12)
    expect(hrefs()).not.toContain('/p0')
    const toasts = useToastStore.getState().toasts
    expect(toasts.at(-1)?.message).toBe('Closed New tab to stay within 12 tabs')
    const last = toasts.at(-1)
    await useToastStore.getState().undo(last?.id ?? '')
    expect(hrefs()).toContain('/p0')
    expect(hrefs()).not.toContain('/p12')
    expect(store().tabs).toHaveLength(12)
  })

  it('allows 8 tabs on a phone', async () => {
    await page.viewport(390, 800)
    store().adopt('u1', '/p0')
    for (let i = 1; i < 12; i++) store().open(`/p${i}`)
    expect(store().tabs).toHaveLength(8)
  })

  it('pins at most 5 tabs and says so', () => {
    store().adopt('u1', '/p0')
    for (let i = 1; i < 7; i++) store().open(`/p${i}`)
    for (const tab of store().tabs.slice(0, 5)) store().togglePin(tab.id)
    expect(store().tabs.filter((t) => t.pinned)).toHaveLength(5)
    const sixth = store().tabs.find((t) => !t.pinned)
    store().togglePin(sixth?.id ?? '')
    expect(store().tabs.filter((t) => t.pinned)).toHaveLength(5)
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('Up to 5 tabs can be pinned')
  })

  it('closing offers Undo and ⌘⇧T style restore brings the tab back', async () => {
    store().adopt('u1', '/a')
    store().open('/b')
    const closing = store().activeId
    store().closeActive()
    expect(hrefs()).toEqual(['/a'])
    await useToastStore.getState().undo(useToastStore.getState().toasts.at(-1)?.id ?? '')
    expect(store().tabs.some((t) => t.id === closing)).toBe(true)
    store().closeActive()
    store().restore()
    expect(hrefs()).toContain('/b')
    expect(store().activeId).toBe(closing)
  })

  it('moves along the strip and goes to a numbered tab', () => {
    store().adopt('u1', '/a')
    store().open('/b')
    store().open('/c')
    store().goTo(1)
    expect(hrefOf(activeTab(store()))).toBe('/a')
    store().step(-1)
    expect(hrefOf(activeTab(store()))).toBe('/c')
    store().goTo(9)
    expect(hrefOf(activeTab(store()))).toBe(hrefs().at(-1))
  })

  it('back and forward stay inside the active tab', () => {
    store().adopt('u1', '/a')
    store().visit('/a/1')
    store().open('/b')
    store().visit('/b/1')
    store().back()
    expect(hrefOf(activeTab(store()))).toBe('/b')
    store().forward()
    expect(hrefOf(activeTab(store()))).toBe('/b/1')
    store().activate(store().tabs.find((t) => hrefOf(t) === '/a/1')?.id ?? '')
    expect(hrefOf(activeTab(store()))).toBe('/a/1')
  })
})
