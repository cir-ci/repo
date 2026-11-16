import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from '@tanstack/query-persist-client-core'
import { defaultShouldDehydrateQuery, type QueryClient } from '@tanstack/react-query'
import { clear, createStore, del, get, set, type UseStore } from 'idb-keyval'

import {
  isPersistable,
  PERSIST_MAX_AGE,
  parsePersisted,
  pruneForStorage,
} from '#lib/persist-policy.ts'
import { forgetPrivateFiles } from '#lib/private-files.ts'
import { clearSessionHint } from '#lib/session-hint.ts'
import { useRecentSearchesStore } from '#lib/stores/recent-searches-store.ts'
import { useRecentStore } from '#lib/stores/recent-store.ts'
import { useTabStore } from '#lib/stores/tab-store.ts'

/**
 * The query cache on this device (IndexedDB), so a page draws from the last data at once and
 * refreshes in the background. One person's cache at a time, under their user ID; dropped when
 * the build changes (`buster`), on sign-out or a 401 and when another person signs in. What may
 * be stored is `persist-policy.ts`'s allowlist, aged and capped there. Where IndexedDB doesn't
 * work (a private window) every call quietly does nothing.
 */

/** The build, from vite.config.ts; a development server has none and shares one value. */
const BUILD_ID = typeof CIRCI_BUILD_ID === 'undefined' ? 'dev' : CIRCI_BUILD_ID

let store: UseStore | undefined
function idb(): UseStore {
  store ??= createStore('circi-cache', 'queries')
  return store
}

interface Active {
  userId: string
  /** Set by `purgePersisted`: a write still in flight must not bring the cache back. */
  dead: boolean
  stop: () => void
  /** The restore in flight (or done), so a second caller waits for the same one. */
  ready: Promise<void>
}
let active: Active | undefined
/** The client being persisted, so a purge in another tab can empty this one's memory too. */
let activeClient: QueryClient | undefined

/**
 * Empties what was fetched as the person who left, in memory. `QueryClient.clear()` would also
 * drop the queries a mounted page is watching (the sign-in page's own, which started a moment
 * ago): their observers keep a query that is no longer in the cache and never hear of it again,
 * so the page stays blank. Queries nobody watches are removed; the watched ones are reset and
 * fetched again.
 */
export function forgetQueries(queryClient: QueryClient): void {
  queryClient.getMutationCache().clear()
  queryClient.removeQueries({ type: 'inactive' })
  void queryClient.resetQueries({ type: 'active' })
}

/**
 * A purge in one tab (sign-out, a 401, another person) tells the others, so none of them writes
 * the old person's cache back afterwards and their memory is emptied as well.
 */
const PURGE_CHANNEL = 'circi-purge'
const channel: BroadcastChannel | undefined =
  typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(PURGE_CHANNEL)
channel?.addEventListener('message', () => {
  stopActive()
  if (activeClient) forgetQueries(activeClient)
  forgetLocalPrivate(false)
})

function persisterFor(userId: string, state: Active) {
  return createAsyncStoragePersister({
    key: `user:${userId}`,
    throttleTime: 2000,
    storage: {
      getItem: (key) => get<string>(key, idb()),
      setItem: async (key, value) => {
        if (!state.dead) await set(key, value, idb())
      },
      removeItem: (key) => del(key, idb()),
    },
    serialize: (client) => JSON.stringify(pruneForStorage(client, { now: Date.now() })),
    // A text that isn't a cache comes back as nothing (restoring then has nothing to add).
    deserialize: (text) =>
      pruneForStorage(
        parsePersisted(text) ?? {
          timestamp: 0,
          buster: '',
          clientState: { mutations: [], queries: [] },
        },
        { now: Date.now() },
      ),
  })
}

function options(queryClient: QueryClient, userId: string, state: Active) {
  return {
    queryClient,
    persister: persisterFor(userId, state),
    maxAge: PERSIST_MAX_AGE,
    buster: BUILD_ID,
    dehydrateOptions: {
      shouldDehydrateQuery: (query: Parameters<typeof defaultShouldDehydrateQuery>[0]) =>
        defaultShouldDehydrateQuery(query) && isPersistable(query.queryKey),
      shouldDehydrateMutation: () => false,
    },
  }
}

/** Fills `queryClient` from this person's stored cache, then keeps storing it. Never rejects. */
export function restorePersisted(queryClient: QueryClient, userId: string): Promise<void> {
  if (active?.userId === userId) return active.ready
  stopActive()
  const state: Active = { userId, dead: false, stop: () => {}, ready: Promise.resolve() }
  active = state
  activeClient = queryClient
  const setup = options(queryClient, userId, state)
  state.ready = (async () => {
    try {
      await persistQueryClientRestore(setup)
    } catch {
      // Unreadable or no IndexedDB: start from the network, as without a stored cache.
    }
    if (state.dead) {
      forgetQueries(queryClient)
      return
    }
    state.stop = persistQueryClientSubscribe(setup)
  })()
  return state.ready
}

/** Starts keeping this person's cache without reading one (a first sign-in); a no-op if already doing so. */
export function startPersisting(queryClient: QueryClient, userId: string): void {
  if (active?.userId === userId) return
  stopActive()
  const state: Active = { userId, dead: false, stop: () => {}, ready: Promise.resolve() }
  active = state
  activeClient = queryClient
  state.stop = persistQueryClientSubscribe(options(queryClient, userId, state))
}

function stopActive(): void {
  if (!active) return
  active.dead = true
  active.stop()
  active = undefined
}

/** What else this browser keeps about the person: recent visits and searches, and the installed app's tabs. */
function forgetLocalPrivate(keepTabs: boolean): void {
  useRecentStore.getState().forgetAll()
  useRecentSearchesStore.getState().forgetAll()
  if (!keepTabs) useTabStore.getState().clear()
}

/**
 * Deletes the stored cache, the remembered person, the recent visits and searches, the installed
 * app's tabs (unless `keepTabs`: another person's were just taken) and the kept screenshots, and
 * stops storing (in the other tabs too). Never rejects.
 */
export async function purgePersisted(keep: { keepTabs?: boolean } = {}): Promise<void> {
  clearSessionHint()
  stopActive()
  forgetLocalPrivate(keep.keepTabs === true)
  try {
    // A BroadcastChannel has no target origin (it never leaves this one).
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    channel?.postMessage('purge')
  } catch {
    // A closed channel: the other tabs find out on their next session check.
  }
  void forgetPrivateFiles()
  try {
    await clear(idb())
  } catch {
    // No IndexedDB: nothing was stored.
  }
}
