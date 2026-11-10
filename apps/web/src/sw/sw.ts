import {
  clickAction,
  entriesToEvict,
  isKeepable,
  MAX_ASSETS,
  notificationOptions,
  parsePushPayload,
  SHELL_CACHE,
  SHELL_KEY,
  strategyFor,
} from './logic.ts'

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

// A new worker takes over at once: the page itself always comes from the network first, so a new
// version shows on the next load, and the cached assets are the content-hashed ones.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== SHELL_CACHE).map((n) => caches.delete(n)))
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

self.addEventListener('fetch', (event) => {
  const { request } = event
  const strategy = strategyFor(request, self.location.origin)
  if (strategy === 'bypass') return
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
