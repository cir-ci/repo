import {
  clickAction,
  entriesToEvict,
  IMAGE_CACHE,
  IMAGE_MAX_ENTRY_BYTES,
  imageKey,
  imagesToEvict,
  imageServable,
  type KeptImage,
  isKeepable,
  MAX_ASSETS,
  mayKeep,
  META_CACHE,
  notificationOptions,
  parsePushPayload,
  SHELL_CACHE,
  SHELL_KEY,
  strategyFor,
} from './logic.ts'
import { missingEntries, staleEntries } from './precache.ts'

/**
 * The service worker, served at `/sw.js` (scope `/`). Built by `vite.config.ts` as its own
 * script, not part of the page's bundle. It keeps the app shell and shows pushes; every decision
 * is in `logic.ts`. The worker's types are declared here because the web app's TypeScript is
 * configured for the page (`dom`), not for a worker.
 */

interface Waitable {
  waitUntil(promise: Promise<unknown>): void
}
interface FetchEventLike extends Waitable {
  request: Request
  respondWith(response: Promise<Response>): void
}
interface MessageEventLike extends Waitable {
  data: unknown
}
interface PushEventLike extends Waitable {
  data: { text(): string } | null
}
interface NotificationEventLike extends Waitable {
  notification: { close(): void; data?: unknown }
}
interface WindowClientLike {
  url: string
  focus(): Promise<WindowClientLike>
  navigate(url: string): Promise<WindowClientLike | null>
}
interface WorkerScope {
  location: { origin: string }
  skipWaiting(): Promise<void>
  addEventListener(type: 'install' | 'activate', listener: (event: Waitable) => void): void
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void
  addEventListener(type: 'push', listener: (event: PushEventLike) => void): void
  addEventListener(
    type: 'notificationclick',
    listener: (event: NotificationEventLike) => void,
  ): void
  registration: {
    showNotification(title: string, options: ReturnType<typeof notificationOptions>): Promise<void>
  }
  clients: {
    claim(): Promise<void>
    matchAll(options: { type: 'window'; includeUncontrolled: true }): Promise<WindowClientLike[]>
    openWindow(url: string): Promise<WindowClientLike | null>
  }
}
declare const self: WorkerScope
/** The hashed files of this build to fetch ahead (vite.config.ts writes them in). */
declare const CIRCI_PRECACHE: string[]

// A new worker takes over at once: the page itself always comes from the network first, so a new
// version shows on the next load, and the cached assets are the content-hashed ones.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((n) => n !== SHELL_CACHE && n !== IMAGE_CACHE && n !== META_CACHE)
          .map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

async function keep(request: Request | string, response: Response): Promise<void> {
  if (!isKeepable(response)) return
  const cache = await caches.open(SHELL_CACHE)
  await cache.put(request, response.clone())
  const stale = entriesToEvict(
    (await cache.keys()).map((r) => new URL(r.url).pathname),
    MAX_ASSETS + 8,
  )
  // The shell and the few static files stay: only assets are ever evicted.
  await Promise.all(stale.filter((p) => p.startsWith('/assets/')).map((p) => cache.delete(p)))
}

/** The screenshots kept, least recently used first; read from the cache once per worker run. */
let imageIndex: KeptImage[] | undefined
async function loadImageIndex(cache: Cache): Promise<KeptImage[]> {
  imageIndex ??= await Promise.all(
    (await cache.keys()).map(async (r) => ({
      key: r.url,
      size: Number((await cache.match(r))?.headers.get('x-circi-size') ?? 0),
    })),
  )
  return imageIndex
}

/**
 * Whose screenshots these are, as the page last said (`user` message). Kept in the meta cache too:
 * the worker is stopped and restarted at will, and a restart must not make anyone's copies serve
 * another person. Unknown means no screenshot is served or kept.
 */
let owner: string | null | undefined
const OWNER_KEY = '/__owner'
async function currentOwner(): Promise<string | null> {
  if (owner !== undefined) return owner
  const kept = await (await caches.open(META_CACHE)).match(OWNER_KEY)
  const id = kept ? await kept.text() : ''
  owner = id === '' ? null : id
  return owner
}
async function setOwner(id: string | null): Promise<void> {
  owner = id
  const cache = await caches.open(META_CACHE)
  if (id === null) await cache.delete(OWNER_KEY)
  else await cache.put(OWNER_KEY, new Response(id))
}

/** Bumped when the screenshots are forgotten: a fetch that began before it must not store its result (it could be the old person's). */
let generation = 0

function stampOf(response: Response) {
  return {
    storedAt: Number(response.headers.get('x-circi-stored-at')),
    owner: response.headers.get('x-circi-owner') ?? '',
  }
}

async function keepImage(
  key: string,
  response: Response,
  started: number,
  keptFor: string,
): Promise<void> {
  const blob = await response.blob()
  if (blob.size > IMAGE_MAX_ENTRY_BYTES) return
  if (!mayKeep(started, generation)) return
  const headers = new Headers(response.headers)
  headers.set('x-circi-stored-at', String(Date.now()))
  headers.set('x-circi-owner', keptFor)
  // The blob is the decoded body: the original's encoding and length no longer describe it.
  headers.delete('content-encoding')
  headers.delete('content-length')
  headers.set('x-circi-size', String(blob.size))
  const cache = await caches.open(IMAGE_CACHE)
  if (!mayKeep(started, generation)) return
  await cache.put(key, new Response(blob, { status: 200, headers }))
  // The page forgot while this was being stored: take it out again.
  if (!mayKeep(started, generation)) {
    await cache.delete(key)
    return
  }
  const index = (await loadImageIndex(cache)).filter((i) => i.key !== key)
  index.push({ key, size: blob.size })
  const gone = new Set(imagesToEvict(index))
  await Promise.all([...gone].map((k) => cache.delete(k)))
  imageIndex = index.filter((i) => !gone.has(i.key))
}

/** Fetches one precache entry (a worker of two runs this down the queue), at low priority. */
async function precacheNext(queue: string[]): Promise<void> {
  const path = queue.shift()
  if (path === undefined) return
  const init: RequestInit & { priority?: 'low' } = { priority: 'low' }
  await fetch(path, init)
    .then((response) => keep(path, response))
    .catch(() => undefined)
  await precacheNext(queue)
}

/** After the first load: removes what older builds kept, then fetches this build's files not kept yet. */
async function precache(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE)
  const kept = (await cache.keys()).map((r) => new URL(r.url).pathname)
  await Promise.all(staleEntries(kept, CIRCI_PRECACHE).map((p) => cache.delete(p)))
  const queue = missingEntries(kept, CIRCI_PRECACHE)
  await Promise.all([precacheNext(queue), precacheNext(queue)])
}

self.addEventListener('message', (event) => {
  const data: unknown = event.data
  const type = typeof data === 'object' && data !== null && 'type' in data ? data.type : undefined
  if (type === 'precache') event.waitUntil(precache())
  // Signed out: no screenshot may outlive the session.
  if (type === 'forget-private') {
    generation += 1
    imageIndex = undefined
    event.waitUntil(Promise.all([caches.delete(IMAGE_CACHE), setOwner(null)]).then(() => undefined))
  }
  // The verified person: a different one than before empties what is kept.
  if (type === 'user' && typeof data === 'object' && data !== null && 'id' in data) {
    const id = data.id
    if (typeof id === 'string' && id !== '') {
      event.waitUntil(
        (async () => {
          if ((await currentOwner()) === id) return
          generation += 1
          imageIndex = undefined
          await caches.delete(IMAGE_CACHE)
          await setOwner(id)
        })(),
      )
    }
  }
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const strategy = strategyFor(request, self.location.origin)
  if (strategy === 'bypass') return
  if (strategy === 'image') {
    const key = imageKey(request.url, self.location.origin)
    if (key === null) return
    event.respondWith(
      (async () => {
        const who = await currentOwner()
        const started = generation
        const kept = who === null ? undefined : await (await caches.open(IMAGE_CACHE)).match(key)
        if (kept && imageServable(stampOf(kept), who, Date.now())) {
          const touched = imageIndex?.find((i) => i.key === key)
          if (imageIndex && touched)
            imageIndex = [...imageIndex.filter((i) => i !== touched), touched]
          return kept
        }
        // Kept or not, expired or another person's copy is fetched again (and replaced).
        const response = await fetch(request)
        if (who !== null && response.status === 200 && response.type === 'basic') {
          event.waitUntil(keepImage(key, response.clone(), started, who))
        } else if (
          kept &&
          (response.status === 401 || response.status === 403 || response.status === 404)
        ) {
          // Access is gone: the copy goes too.
          event.waitUntil(caches.open(IMAGE_CACHE).then((c) => c.delete(key)))
        }
        return response
      })(),
    )
    return
  }
  if (strategy === 'page') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          event.waitUntil(keep(SHELL_KEY, response.clone()))
          return response
        } catch {
          const kept = await (await caches.open(SHELL_CACHE)).match(SHELL_KEY)
          if (kept) return kept
          throw new Error('offline and no page kept')
        }
      })(),
    )
    return
  }
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      const kept = await cache.match(request)
      if (strategy === 'asset' && kept) return kept
      const fresh = fetch(request).then(async (response) => {
        await keep(request, response.clone())
        return response
      })
      if (kept) {
        // Served from the cache now; the fresh copy replaces it for next time.
        event.waitUntil(fresh.catch(() => undefined))
        return kept
      }
      return fresh
    })(),
  )
})

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event.data ? event.data.text() : null)
  event.waitUntil(self.registration.showNotification(payload.title, notificationOptions(payload)))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data: unknown = event.notification.data
  const record: Record<string, unknown> =
    typeof data === 'object' && data !== null ? Object.fromEntries(Object.entries(data)) : {}
  const path = typeof record['url'] === 'string' ? record['url'] : '/'
  const id = typeof record['tag'] === 'string' ? record['tag'] : ''
  event.waitUntil(
    (async () => {
      // The Inbox item it was about is read now; if the request fails the item just stays unread.
      if (id) {
        await fetch(`/api/inbox/${encodeURIComponent(id)}/read`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ read: true }),
          credentials: 'same-origin',
        }).catch(() => undefined)
      }
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const action = clickAction(windows, path, self.location.origin)
      const target = windows[action.kind === 'open' ? 0 : action.index]
      if (action.kind === 'open' || !target) {
        await self.clients.openWindow(path)
      } else if (action.kind === 'focus') {
        await target.focus()
      } else {
        await target.focus()
        await target.navigate(path)
      }
    })(),
  )
})
