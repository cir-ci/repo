/**
 * The service worker's decisions, as pure functions (`sw.ts` only wires them to the browser's
 * events), so they are tested in Node.
 *
 * The worker keeps the app shell available (built assets, the page itself when offline) and shows
 * pushes. It never keeps anything the server answers from `/api`: those hold people's data.
 */

/** Bump to drop what older workers cached (their entries are deleted when this one activates). */
export const SHELL_CACHE = 'circi-shell-v1'
/** The page every client-side route is answered with, kept for when the network is down. */
export const SHELL_KEY = '/'
/** Most assets kept; the oldest go first. */
export const MAX_ASSETS = 200

/** Paths the server answers itself (JSON, files, webhooks, probes): the worker never touches them. */
const SERVER_PREFIXES = ['/api/', '/v1/', '/v2/', '/webhooks/', '/internal/']
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

export interface RequestLike {
  method: string
  url: string
  /** `navigate` for a page load. */
  mode: string
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
      url: url?.startsWith('/') && !url.startsWith('//') ? url : '/',
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
