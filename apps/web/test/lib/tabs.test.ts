import { describe, expect, it } from 'vitest'

import {
  activate,
  activeTab,
  closeOthers,
  closeTab,
  createTab,
  DESKTOP_LIMITS,
  duplicateTab,
  evictionCandidate,
  hrefOf,
  moveTab,
  neighbour,
  NEW_TAB_HREF,
  openTab,
  parseStoredTabs,
  PHONE_LIMITS,
  replaceCurrent,
  restoreClosed,
  setTitle,
  stepHistory,
  tabAt,
  togglePin,
  undoEviction,
  visit,
  type TabsState,
} from '#lib/tabs.ts'

/** A strip of tabs named by their ids, in that order, the first active; each was last used in turn. */
function strip(...ids: string[]): TabsState {
  const tabs = ids.map((id, i) => ({ ...createTab(id, `/${id}`, i + 1) }))
  return { tabs, activeId: ids[0] ?? 'a', closed: [] }
}

const ids = (state: TabsState) => state.tabs.map((t) => t.id)
const L = DESKTOP_LIMITS

describe('opening tabs', () => {
  it('opens beside the active tab and takes focus unless it is a background tab', () => {
    const state = strip('a', 'b', 'c')
    const opened = openTab(state, { id: 'n', href: '/n', now: 10, limits: L })
    expect(ids(opened.state)).toEqual(['a', 'n', 'c', 'b'])
    expect(opened.state.activeId).toBe('n')
    expect(activeTab(opened.state).opener).toBe('a')
    const quiet = openTab(state, { id: 'q', href: '/q', now: 10, background: true, limits: L })
    expect(quiet.state.activeId).toBe('a')
  })

  it('opens after the pinned tabs when the active tab is further left than they end', () => {
    let state = strip('a', 'b', 'c')
    state = togglePin(state, 'c', L)
    const opened = openTab(state, { id: 'n', href: '/n', now: 10, limits: L })
    expect(ids(opened.state)[0]).toBe('c')
    expect(opened.state.tabs.filter((t) => t.pinned)).toHaveLength(1)
  })

  it('closes the least recently used unpinned background tab at the limit', () => {
    let state = strip('a', 'b', 'c', 'd')
    state = activate(state, 'b', 50)
    state = activate(state, 'a', 60)
    state = togglePin(state, 'c', { max: 4, pinned: 5 })
    // b was used last at 50, d at 5, so d is the least recently used unpinned background tab.
    expect(evictionCandidate(state)?.id).toBe('d')
    const opened = openTab(state, { id: 'n', href: '/n', now: 70, limits: { max: 4, pinned: 5 } })
    expect(opened.evicted?.tab.id).toBe('d')
    expect(opened.state.tabs).toHaveLength(4)
    expect(opened.state.closed[0]?.tab.id).toBe('d')
    expect(opened.state.activeId).toBe('n')
  })

  it('never evicts a pinned tab or the active one', () => {
    let state = strip('a', 'b', 'c')
    state = togglePin(state, 'b', L)
    state = togglePin(state, 'c', L)
    const opened = openTab(state, { id: 'n', href: '/n', now: 9, limits: { max: 3, pinned: 5 } })
    // Only `a` is unpinned and it is active: nothing can make room.
    expect(opened.evicted).toBeUndefined()
  })

  it('takes an eviction back: the new tab goes and the old one returns in its place', () => {
    const state = strip('a', 'b', 'c')
    const limits = { max: 3, pinned: 5 }
    const opened = openTab(state, { id: 'n', href: '/n', now: 20, limits })
    if (!opened.evicted) throw new Error('nothing was evicted')
    const back = undoEviction(opened.state, 'n', opened.evicted)
    expect(ids(back)).toEqual(ids(state))
    expect(back.closed).toEqual([])
    expect(back.tabs.some((t) => t.id === 'n')).toBe(false)
  })

  it('has smaller limits on a phone', () => {
    expect(DESKTOP_LIMITS).toEqual({ max: 12, pinned: 5 })
    expect(PHONE_LIMITS).toEqual({ max: 8, pinned: 5 })
  })

  it('stays at 12 tabs when many are opened', () => {
    let state = strip('t0')
    for (let i = 1; i < 20; i++)
      state = openTab(state, { id: `t${i}`, href: `/t${i}`, now: i + 1, limits: L }).state
    expect(state.tabs).toHaveLength(12)
    expect(state.activeId).toBe('t19')
  })
})

describe('closing and restoring', () => {
  it('hands the active tab to the tab it was opened from, else its neighbour', () => {
    let state = strip('a', 'b', 'c')
    state = openTab(state, { id: 'n', href: '/n', now: 5, limits: L }).state
    expect(closeTab(state, 'n', 'x', 6).activeId).toBe('a')
    const middle = activate(strip('a', 'b', 'c'), 'b', 5)
    expect(closeTab(middle, 'b', 'x', 6).activeId).toBe('c')
    const last = activate(strip('a', 'b', 'c'), 'c', 5)
    expect(closeTab(last, 'c', 'x', 6).activeId).toBe('b')
  })

  it('keeps one tab: closing the last becomes a new tab on the Inbox', () => {
    const state = closeTab(strip('a'), 'a', 'fresh', 9)
    expect(ids(state)).toEqual(['fresh'])
    expect(hrefOf(activeTab(state))).toBe(NEW_TAB_HREF)
    expect(state.closed[0]?.tab.id).toBe('a')
  })

  it('restores the newest closed tab where it was, and activates it', () => {
    let state = strip('a', 'b', 'c')
    state = activate(state, 'c', 4)
    state = closeTab(state, 'b', 'x', 5)
    state = closeTab(state, 'c', 'x', 6)
    const first = restoreClosed(state, L, 7)
    if (!first) throw new Error('nothing to restore')
    expect(first.state.activeId).toBe('c')
    const second = restoreClosed(first.state, L, 8)
    if (!second) throw new Error('nothing to restore')
    expect(ids(second.state)).toContain('b')
    expect(second.state.closed).toEqual([])
    expect(restoreClosed(second.state, L, 9)).toBeNull()
  })

  it('closes the others but never the pinned ones', () => {
    let state = strip('a', 'b', 'c', 'd')
    state = togglePin(state, 'd', L)
    const next = closeOthers(state, 'b')
    expect(ids(next).toSorted()).toEqual(['b', 'd'])
    expect(next.activeId).toBe('b')
    expect(next.closed.map((c) => c.tab.id).toSorted()).toEqual(['a', 'c'])
    expect(closeOthers(next, 'b')).toBe(next)
  })

  it('remembers at most 20 closed tabs', () => {
    let state = strip('t0')
    for (let i = 1; i <= 30; i++) {
      state = openTab(state, { id: `t${i}`, href: '/x', now: i, limits: L }).state
      state = closeTab(state, `t${i}`, 'x', i)
    }
    expect(state.closed).toHaveLength(20)
  })
})

describe('moving between tabs', () => {
  const state = strip('a', 'b', 'c')

  it('steps to the previous and next tab, wrapping', () => {
    const first = state.tabs[0]?.id
    expect(first).toBe('a')
    expect(neighbour(state, 1)?.id).toBe(state.tabs[1]?.id)
    expect(neighbour(state, -1)?.id).toBe(state.tabs[2]?.id)
  })

  it('goes to a numbered tab, with 9 the last', () => {
    expect(tabAt(state, 1)?.id).toBe('a')
    expect(tabAt(state, 9)?.id).toBe(state.tabs.at(-1)?.id)
    expect(tabAt(state, 7)).toBeUndefined()
  })

  it('moves a tab one place, but not across the pinned boundary', () => {
    const moved = moveTab(state, 'a', 1)
    expect(ids(moved)).toEqual([state.tabs[1]?.id, 'a', state.tabs[2]?.id])
    expect(moveTab(state, 'a', -1)).toBe(state)
    const pinned = togglePin(state, 'c', L)
    const pinnedFirst = pinned.tabs[0]
    expect(pinnedFirst?.pinned).toBe(true)
    expect(moveTab(pinned, 'a', -1)).toBe(pinned)
    expect(moveTab(pinned, pinnedFirst?.id ?? '', 1)).toBe(pinned)
  })
})

describe('pinning', () => {
  it('gathers pinned tabs at the start and lets go again', () => {
    let state = strip('a', 'b', 'c')
    state = togglePin(state, 'c', L)
    expect(state.tabs[0]?.id).toBe('c')
    state = togglePin(state, 'c', L)
    expect(state.tabs.every((t) => !t.pinned)).toBe(true)
  })

  it('refuses a sixth pinned tab', () => {
    let state = strip('a', 'b', 'c', 'd', 'e', 'f', 'g')
    for (const id of ['a', 'b', 'c', 'd', 'e']) state = togglePin(state, id, L)
    expect(state.tabs.filter((t) => t.pinned)).toHaveLength(5)
    expect(togglePin(state, 'f', L)).toBe(state)
  })

  it('duplicates a tab beside it with the same page and title', () => {
    let state = setTitle(strip('a', 'b'), 'a', 'Builds')
    state = visit(state, '/a/2')
    const copy = duplicateTab(state, 'a', { id: 'copy', now: 9, limits: L })
    const tab = copy?.state.tabs.find((t) => t.id === 'copy')
    expect(tab?.history).toEqual(['/a/2'])
    expect(tab?.title).toBe('Builds')
  })
})

describe('a tab has its own history', () => {
  it('visits push onto the active tab only', () => {
    let state = strip('a', 'b')
    state = visit(state, '/a/1')
    state = visit(state, '/a/2')
    expect(activeTab(state).history).toEqual(['/a', '/a/1', '/a/2'])
    expect(state.tabs.find((t) => t.id === 'b')?.history).toEqual(['/b'])
  })

  it('ignores a visit to the page already showing', () => {
    const state = strip('a')
    expect(visit(state, '/a')).toBe(state)
  })

  it('back and forward walk the tab and stop at its ends', () => {
    let state = visit(visit(strip('a', 'b'), '/a/1'), '/a/2')
    state = stepHistory(state, -1, 'x', 1)
    expect(hrefOf(activeTab(state))).toBe('/a/1')
    state = stepHistory(state, -1, 'x', 1)
    expect(hrefOf(activeTab(state))).toBe('/a')
    // Back at the first page of a tab that wasn't opened from another does nothing.
    expect(stepHistory(state, -1, 'x', 1)).toBe(state)
    state = stepHistory(state, 1, 'x', 1)
    expect(hrefOf(activeTab(state))).toBe('/a/1')
    state = stepHistory(state, 1, 'x', 1)
    expect(stepHistory(state, 1, 'x', 1)).toBe(state)
  })

  it('back never crosses tabs: another tab keeps its page', () => {
    let state = visit(strip('a', 'b'), '/a/1')
    state = activate(state, 'b', 5)
    state = stepHistory(state, -1, 'x', 5)
    expect(state.activeId).toBe('b')
    expect(state.tabs.find((t) => t.id === 'a')?.index).toBe(1)
  })

  it('a visit after going back drops the forward pages', () => {
    let state = visit(visit(strip('a'), '/a/1'), '/a/2')
    state = stepHistory(state, -1, 'x', 1)
    state = visit(state, '/a/other')
    expect(activeTab(state).history).toEqual(['/a', '/a/1', '/a/other'])
  })

  it('back from the first page of a tab opened from another closes it and returns there', () => {
    const opened = openTab(strip('a'), { id: 'n', href: '/n', now: 5, limits: L }).state
    const back = stepHistory(opened, -1, 'x', 6)
    expect(back.activeId).toBe('a')
    expect(ids(back)).toEqual(['a'])
  })

  it('replace changes the current page without a new entry', () => {
    let state = visit(strip('a'), '/a/1')
    state = replaceCurrent(state, '/a/1?sort=name')
    expect(activeTab(state).history).toEqual(['/a', '/a/1?sort=name'])
  })

  it('keeps at most 50 pages per tab', () => {
    let state = strip('a')
    for (let i = 0; i < 80; i++) state = visit(state, `/a/${i}`)
    const tab = activeTab(state)
    expect(tab.history).toHaveLength(50)
    expect(hrefOf(tab)).toBe('/a/79')
  })
})

describe('storing tabs', () => {
  it('reads back what it wrote', () => {
    let state = visit(strip('a', 'b'), '/a/1')
    state = togglePin(state, 'b', L)
    state = closeTab(state, 'a', 'x', 3)
    const parsed = parseStoredTabs(JSON.stringify({ owner: 'u1', state }))
    expect(parsed).toEqual({ owner: 'u1', state })
  })

  it('refuses what is not a tab set', () => {
    expect(parseStoredTabs(null)).toBeNull()
    expect(parseStoredTabs('not json')).toBeNull()
    expect(parseStoredTabs('{}')).toBeNull()
    expect(parseStoredTabs(JSON.stringify({ owner: 'u', state: { tabs: [] } }))).toBeNull()
  })

  it('drops broken tabs and an active ID that matches none', () => {
    const good = { id: 'a', title: '', pinned: false, history: ['/a'], index: 0, usedAt: 1 }
    const bad = { ...good, id: 'b', index: 5 }
    const offSite = { ...good, id: 'c', history: ['https://evil.example'] }
    const parsed = parseStoredTabs(
      JSON.stringify({ owner: 'u', state: { tabs: [good, bad, offSite], activeId: 'zzz' } }),
    )
    expect(parsed?.state.tabs.map((t) => t.id)).toEqual(['a'])
    expect(parsed?.state.activeId).toBe('a')
    expect(parsed?.state.closed).toEqual([])
  })
})
