import { QueryClient } from '@tanstack/react-query'
import { clear, createStore, get, keys as idbKeys } from 'idb-keyval'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { purgePersisted, restorePersisted, startPersisting } from '#lib/query-persist.ts'
import { readSessionHint, writeSessionHint } from '#lib/session-hint.ts'
import { RECENT_SEARCHES_KEY, useRecentSearchesStore } from '#lib/stores/recent-searches-store.ts'
import { RECENT_KEY, useRecentStore } from '#lib/stores/recent-store.ts'
import { TABS_KEY, useTabStore } from '#lib/stores/tab-store.ts'

// Real IndexedDB, in Chromium; nothing is faked here.
const idb = () => createStore('circi-cache', 'queries')
const stored = () => idbKeys(idb())
const client = () => new QueryClient({ defaultOptions: { queries: { gcTime: 24 * 3600_000 } } })

afterEach(async () => {
  await purgePersisted()
  await clear(idb())
})

/** The persister throttles its writes by two seconds; fake timers would starve IndexedDB, so wait for real. */
async function untilStored(userId: string) {
  // The first write (the query was added, still empty) can come before the data: wait for the data.
  await vi.waitFor(async () => expect(await get(`user:${userId}`, idb())).toContain('"items"'), {
    timeout: 6000,
  })
}

describe('the stored query cache', () => {
  it('stores allowlisted data and a new session restores it, but never a token or a secret', async () => {
    const first = client()
    startPersisting(first, 'u1')
    first.setQueryData(['inbox', 'for-you'], { items: [{ id: 'n1' }] })
    first.setQueryData(['token', 'acme', 'web'], { prefix: 'circi_AbC1' })
    first.setQueryData(['integrations', 'acme'], { webhook: { secret: 'shh' } })
    await untilStored('u1')

    // A new page load: nothing in memory is active any more (another person's restore stops the
    // first's writes without touching what is stored).
    await restorePersisted(client(), 'someone-else')
    const second = client()
    await restorePersisted(second, 'u1')
    expect(second.getQueryData(['inbox', 'for-you'])).toEqual({ items: [{ id: 'n1' }] })
    expect(second.getQueryData(['token', 'acme', 'web'])).toBeUndefined()
    expect(second.getQueryData(['integrations', 'acme'])).toBeUndefined()
  })

  it("never shows one person another person's data", async () => {
    const first = client()
    startPersisting(first, 'u1')
    first.setQueryData(['inbox', 'for-you'], { items: [1] })
    await untilStored('u1')

    const other = client()
    await restorePersisted(other, 'u2')
    expect(other.getQueryData(['inbox', 'for-you'])).toBeUndefined()
  })

  it('is emptied by a purge: the data, the remembered person, and what a late write would add', async () => {
    const first = client()
    startPersisting(first, 'u1')
    writeSessionHint({ id: 'u1', name: 'Ada', email: 'a@b.test', image: null })
    first.setQueryData(['inbox', 'for-you'], { items: [1] })
    await untilStored('u1')

    await purgePersisted()
    expect(await stored()).toEqual([])
    expect(readSessionHint()).toBeNull()
    // A change after the purge is not written back.
    first.setQueryData(['inbox', 'for-you'], { items: [2] })
    await new Promise((resolve) => setTimeout(resolve, 2600))
    expect(await stored()).toEqual([])
    const again = client()
    await restorePersisted(again, 'u1')
    expect(again.getQueryData(['inbox', 'for-you'])).toBeUndefined()
  }, 15_000)

  it("purging also forgets the person's recent visits and searches and the installed app's tabs", async () => {
    useRecentStore.getState().record('acme', {
      kind: 'build',
      id: 'b1',
      label: 'Build #1',
      path: '/acme/web/builds/1',
      at: 1,
    })
    useRecentSearchesStore.getState().record('acme', 'checkout')
    useTabStore.getState().adopt('u1', '/acme')
    expect(localStorage.getItem(RECENT_KEY)).not.toBeNull()
    expect(localStorage.getItem(TABS_KEY)).not.toBeNull()

    await purgePersisted()

    expect(localStorage.getItem(RECENT_KEY)).toBeNull()
    expect(localStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull()
    expect(localStorage.getItem(TABS_KEY)).toBeNull()
    expect(useRecentStore.getState().byWorkspace).toEqual({})
    expect(useRecentSearchesStore.getState().byWorkspace).toEqual({})
    expect(useTabStore.getState().tabs).toEqual([])
  })

  it('keeps the tabs when told to (another person has just taken them)', async () => {
    useTabStore.getState().adopt('u2', '/acme')
    await purgePersisted({ keepTabs: true })
    expect(useTabStore.getState().tabs.length).toBeGreaterThan(0)
    useTabStore.getState().clear()
  })

  it("another tab's purge stops this tab storing and empties its memory", async () => {
    const mine = client()
    startPersisting(mine, 'u1')
    mine.setQueryData(['inbox', 'for-you'], { items: [1] })
    await untilStored('u1')
    // The other tab's purge deleted the store; this tab must not write it back.
    await clear(idb())
    const other = new BroadcastChannel('circi-purge')
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    other.postMessage('purge')
    other.close()
    await vi.waitFor(() => expect(mine.getQueryData(['inbox', 'for-you'])).toBeUndefined())
    mine.setQueryData(['inbox', 'for-you'], { items: [2] })
    await new Promise((resolve) => setTimeout(resolve, 2600))
    expect(await stored()).toEqual([])
  }, 15_000)
})
