/**
 * The service worker's decisions, as pure functions (`sw.ts` only wires them to the browser's
 * events), so they are tested in Node.
 *
 * The worker keeps the app shell available (built assets, the page itself when offline) and shows
 * pushes. It never keeps anything the server answers from `/api` except screenshots
 * (`/api/files/<sha256>`, content-addressed, in their own capped cache that is emptied when the
 * session ends); the rest holds people's data.
 */

/** Bump to drop what older workers cached (their entries are deleted when this one activates). */
export const SHELL_CACHE = 'circi-shell-v1'
/** The page every client-side route is answered with, kept for when the network is down. */
export const SHELL_KEY = '/'
/** Most assets kept (a build's whole precache list is ~350 files, an older build's go by name, see `staleEntries`); the oldest go first. */
export const MAX_ASSETS = 700

/** Kept screenshots, apart from the shell so each has its own cap and sign-out can empty it. */
export const IMAGE_CACHE = 'circi-images-v1'
/** At most this many screenshots, and this many bytes of them; the least recently used go first. */
export const IMAGE_MAX_COUNT = 300
export const IMAGE_MAX_BYTES = 200 * 1024 * 1024
/**
 * A kept screenshot is served for this long (the server's signed-link window,
 * `FILE_URL_WINDOW_SECONDS` in `@circi/core/node`, which the worker can't import): the server
 * checks access again when a link is issued, so a copy must not outlive losing access by longer.
 * Older entries are a miss and are fetched again.
 */
export const IMAGE_MAX_AGE_MS = 3600 * 1000
/** The cache holding the signed-in person's ID, apart from the screenshots (the worker may be restarted any time). */
export const META_CACHE = 'circi-meta-v1'
/** A single file bigger than this is not kept. */
export const IMAGE_MAX_ENTRY_BYTES = 20 * 1024 * 1024

/** Paths the server answers itself (JSON, files, webhooks, probes): the worker never touches them. */
const SERVER_PREFIXES = ['/api/', '/v1/', '/webhooks/', '/internal/']
const SERVER_PATHS = new Set(['/healthz', '/readyz', '/sw.js'])

export type Strategy =
  /** Not ours: the browser handles it as if there were no worker. */
  | 'bypass'
  /** The page: the network first (so a new version shows on the next load), the kept shell offline. */
  | 'page'
  /** Content-hashed build output: kept, served from the cache first (it never changes under its name). */
  | 'asset'
  /** Icons and the manifest: served from the cache while a fresh copy is fetched behind it. */
  | 'static'
  /** A screenshot by its hash: kept by path (the signature in the query changes hourly), the cache first. */
  | 'image'

export interface RequestLike {
  method: string
  url: string
  /** `navigate` for a page load. */
  mode: string
}

const IMAGE_PATH = /^\/api\/files\/[0-9a-f]{64}$/

/**
 * The cache key of a screenshot request: its address without the query (the hourly signature
 * is only proof of access; the hash in the path is the content, so a kept file is always the
 * right one). Null for anything else.
 */
export function imageKey(requestUrl: string, origin: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  return url.origin === origin && IMAGE_PATH.test(url.pathname) ? `${origin}${url.pathname}` : null
}

/** What a kept screenshot remembers about itself (headers on the stored response). */
export interface ImageStamp {
  /** When it was kept (ms since the epoch). */
  storedAt: number
  /** The person whose session fetched it. */
  owner: string
}

/**
 * Whether a kept screenshot may be served now: kept for this very person and within the link
 * window. No known person (`current` null), another person's, a missing stamp or a clock gone
 * backwards: a miss.
 */
export function imageServable(
  stamp: Partial<ImageStamp> | null,
  current: string | null,
  now: number,
): boolean {
  if (current === null || !stamp) return false
  if (stamp.owner !== current) return false
  const at = stamp.storedAt
  return typeof at === 'number' && at <= now && now - at <= IMAGE_MAX_AGE_MS
}

/** Whether a fetch that started under `started` may still store its result (`forget-private` or a new person bumps the generation). */
export function mayKeep(started: number, current: number): boolean {
  return started === current
}

/**
 * The path, search and hash of an address if it is in this app (same origin), else null. A
 * backslash is a slash to the browser (`/\evil.example` goes to another site), so the address is
 * resolved the way the browser would, not matched by its first characters.
 */
export function sameOriginPath(address: string, origin: string): string | null {
  try {
    const url = new URL(address, origin)
    return url.origin === origin ? url.pathname + url.search + url.hash : null
  } catch {
    return null
  }
}

export interface KeptImage {
  key: string
  size: number
}

/** The keys to delete so at most `maxCount` files and `maxBytes` stay; `kept` runs least recently used first. */
export function imagesToEvict(
  kept: readonly KeptImage[],
  maxCount = IMAGE_MAX_COUNT,
  maxBytes = IMAGE_MAX_BYTES,
): string[] {
  let count = kept.length
  let bytes = kept.reduce((sum, image) => sum + image.size, 0)
  const out: string[] = []
  for (const image of kept) {
    if (count <= maxCount && bytes <= maxBytes) break
    out.push(image.key)
    count -= 1
    bytes -= image.size
  }
  return out
}

/** How a request is answered. Only same-origin GETs outside the server's own paths are ever kept. */
export function strategyFor(request: RequestLike, origin: string): Strategy {
  if (request.method !== 'GET') return 'bypass'
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return 'bypass'
  }
  if (url.origin !== origin) return 'bypass'
  const path = url.pathname
  if (IMAGE_PATH.test(path)) return 'image'
  if (SERVER_PATHS.has(path) || SERVER_PREFIXES.some((p) => path.startsWith(p))) return 'bypass'
  if (request.mode === 'navigate') return 'page'
  if (path.startsWith('/assets/')) return 'asset'
  if (path.startsWith('/icons/') || path === '/manifest.webmanifest') return 'static'
  return 'bypass'
}

export interface ResponseLike {
  status: number
  type: string
  redirected?: boolean
}

/** Only a plain successful answer is worth keeping: not an error, a redirect or an opaque reply. */
export function isKeepable(response: ResponseLike): boolean {
  return response.status === 200 && response.type === 'basic' && response.redirected !== true
}

/** What `respondFromCache` needs of the worker: the cache, the network and the worker's lifetime. */
export interface CacheServing {
  /** The kept copy of the request, if any. A cache that can't be read is a miss. */
  match(request: Request): Promise<Response | undefined>
  /** Stores a copy; may be slow or fail. */
  keep(request: Request, response: Response): Promise<void>
  fetch(request: Request): Promise<Response>
  /** Keeps the worker alive for work that outlasts the reply. */
  waitUntil(promise: Promise<unknown>): void
}

/**
 * The reply to a request for a built file or a static one. An `asset` (its name carries its
 * content hash) is served from the cache when kept; a `static` file is served from the cache while
 * a fresh copy is fetched behind it. Otherwise the network answers, and storing a copy is for the
 * next time: the page never waits for it (the cache writes of one origin queue up behind each
 * other, and the precache is writing hundreds of files then) and a copy that can't be stored
 * never fails the request.
 */
export async function respondFromCache(
  strategy: 'asset' | 'static',
  request: Request,
  serving: CacheServing,
): Promise<Response> {
  const kept = await serving.match(request).catch(() => undefined)
  if (strategy === 'asset' && kept) return kept
  const fresh = serving.fetch(request).then((response) => {
    serving.waitUntil(serving.keep(request, response.clone()).catch(() => undefined))
    return response
  })
  if (kept) {
    serving.waitUntil(fresh.catch(() => undefined))
    return kept
  }
  return fresh
}

/** The entries to delete so at most `max` stay, oldest (first in `keys`) first. */
export function entriesToEvict(keys: readonly string[], max: number): string[] {
  return keys.length > max ? keys.slice(0, keys.length - max) : []
}

/** What the server sends in a push (`composePushMessage` in `@circi/services`). */
export interface PushPayload {
  title: string
  body: string
  /** An app path to open. */
  url: string
  /** The notification's ID: one notification per event, and the Inbox item to mark read. */
  tag: string
  project: string | null
}

/** A stand-in origin to resolve the pushed address against; only whether it stays on it matters. */
const ORIGIN_FOR_PARSING = 'https://circi.invalid'

/** Reads a push body; a body that is missing or not ours still shows something sensible. */
export function parsePushPayload(text: string | null): PushPayload {
  const fallback: PushPayload = { title: 'CirCI', body: '', url: '/', tag: '', project: null }
  if (!text) return fallback
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return fallback
    const fields: Record<string, unknown> = Object.fromEntries(Object.entries(value))
    const str = (key: string) => {
      const v = fields[key]
      return typeof v === 'string' ? v : undefined
    }
    const url = str('url')
    return {
      title: str('title') || fallback.title,
      body: str('body') ?? '',
      // Only a path in this app: a push never sends a window to another site.
      url: (url !== undefined && sameOriginPath(url, ORIGIN_FOR_PARSING)) || '/',
      tag: str('tag') ?? '',
      project: str('project') ?? null,
    }
  } catch {
    return fallback
  }
}

/** The options for `showNotification`. */
export function notificationOptions(payload: PushPayload) {
  return {
    body: payload.body,
    ...(payload.tag ? { tag: payload.tag } : {}),
    icon: '/icons/192.png',
    badge: '/icons/192.png',
    data: { url: payload.url, tag: payload.tag },
  }
}

export interface WindowLike {
  /** The address the window shows. */
  url: string
}

export type ClickAction =
  /** A window already shows this page: bring it to the front. */
  | { kind: 'focus'; index: number }
  /** An app window is open on another page: bring it to the front and go there. */
  | { kind: 'navigate'; index: number }
  | { kind: 'open' }

/**
 * What tapping a notification does: focus a window already on that page, else reuse an open app
 * window, else open one.
 */
export function clickAction(
  windows: readonly WindowLike[],
  path: string,
  origin: string,
): ClickAction {
  const target = new URL(path, origin)
  const same = (w: WindowLike) => {
    try {
      const u = new URL(w.url)
      return u.origin === origin
    } catch {
      return false
    }
  }
  const exact = windows.findIndex((w) => {
    if (!same(w)) return false
    const u = new URL(w.url)
    return u.pathname === target.pathname && u.search === target.search
  })
  if (exact >= 0) return { kind: 'focus', index: exact }
  const anyApp = windows.findIndex(same)
  return anyApp >= 0 ? { kind: 'navigate', index: anyApp } : { kind: 'open' }
}
