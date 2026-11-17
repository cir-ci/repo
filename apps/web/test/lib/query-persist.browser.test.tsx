import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { clear, createStore, get, keys as idbKeys } from 'idb-keyval'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  forgetQueries,
  purgePersisted,
  restorePersisted,
  startPersisting,
} from '#lib/query-persist.ts'
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
async function untilStored(userId: string, marker = 'items') {
  // The first write (the query was added, still empty) can come before the data: wait for the data.
  await vi.waitFor(
    async () => expect(await get(`user:${userId}`, idb())).toContain(`"${marker}"`),
    {
      timeout: 6000,
    },
  )
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

  it('draws a restored page at once but fetches it again, even when it was fetched a moment ago', async () => {
    const first = client()
    startPersisting(first, 'u1')
    first.setQueryData(['workspace-domains', 'acme'], { domains: [{ verified: false }] })
    await untilStored('u1', 'domains')

    // A reload seconds later: the stored copy is younger than staleTime, and would count as fresh.
    await restorePersisted(client(), 'someone-else')
    const second = new QueryClient({
      defaultOptions: { queries: { gcTime: 24 * 3600_000, staleTime: 60_000 } },
    })
    await restorePersisted(second, 'u1')
    expect(second.getQueryData(['workspace-domains', 'acme'])).toEqual({
      domains: [{ verified: false }],
    })
    const fetched = vi.fn<() => Promise<unknown>>(() =>
      Promise.resolve({ domains: [{ verified: true }] }),
    )
    const observer = new QueryObserver(second, {
      queryKey: ['workspace-domains', 'acme'],
      queryFn: fetched,
    })
    const stop = observer.subscribe(() => {})
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toEqual({ domains: [{ verified: true }] }),
    )
    expect(fetched).toHaveBeenCalledOnce()
    stop()
  })

  it('stores what was already fetched when it starts, not only what changes afterwards', async () => {
    const first = client()
    first.setQueryData(['inbox', 'for-you'], { items: [{ id: 'early' }] })
    startPersisting(first, 'u1')
    await untilStored('u1', 'early')
    expect(await get('user:u1', idb())).toContain('"early"')
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

  it("forgetting drops the old person's data but leaves a page that is loading its own to finish", async () => {
    const mine = client()
    mine.setQueryData(['inbox', 'for-you'], { items: [1] })
    mine.setQueryData(['projects', 'acme'], { items: [2] })
    // The sign-in page has just started its own request when the old data is dropped.
    const reply = { send: (_value: string) => {} }
    const observer = new QueryObserver(mine, {
      queryKey: ['setup'],
      queryFn: () => new Promise<string>((resolve) => (reply.send = resolve)),
    })
    const stop = observer.subscribe(() => {})
    // And a page still showing the old person's list refetches it once reset.
    const watching = new QueryObserver(mine, {
      queryKey: ['projects', 'acme'],
      queryFn: () => Promise.resolve({ items: [] }),
      staleTime: Infinity,
    })
    const stopWatching = watching.subscribe(() => {})

    forgetQueries(mine)
    expect(mine.getQueryData(['inbox', 'for-you'])).toBeUndefined()
    reply.send('{"needed":false}')
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('{"needed":false}'))
    await vi.waitFor(() => expect(watching.getCurrentResult().data).toEqual({ items: [] }))
    stop()
    stopWatching()
  })
})
