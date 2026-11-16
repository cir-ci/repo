import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { liveInvalidations, parseLiveEvent } from '#lib/live-keys.ts'
import { invalidateAll } from '#lib/query-keys.ts'
import { useLiveStore } from '#lib/stores/live-store.ts'

/**
 * Live updates: one `EventSource` on `/api/live` for the signed-in app. Each event names what
 * changed (`Live.Event`, no data); the queries it makes stale refetch (`liveInvalidations`), so a
 * page updates in place instead of polling.
 *
 * - Events that arrive together (a finished build touches many lists) invalidate once.
 * - A dropped connection is retried with a growing delay when the browser won't (an HTTP error:
 *   the server has no feed, or the session ended); the browser retries a network drop itself.
 * - Whatever happened while the stream was down is unknown, so a reconnect invalidates
 *   everything on screen once, as does coming back to a tab that was hidden long enough for the
 *   stream to be closed (a hidden tab doesn't hold a connection).
 * - While the stream is down the old polls run at their old pace (`livePoll`).
 */

const URL = '/api/live'
/** A reconnect delay for each failure in a row; the last repeats. */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000]
/** A tab hidden this long closes its stream and catches up when it is shown again. */
export const HIDDEN_CLOSE_MS = 60_000
/** Events within this window are invalidated together. */
export const BATCH_MS = 150
/** The safety-net poll for a page that used to poll fast, while the stream is up. */
export const SLOW_POLL_MS = 30_000
/** `EventSource.CLOSED`: the browser gave up (an HTTP error), so we reconnect ourselves. */
const CLOSED = 2

/** The part of `EventSource` this module uses, so tests can drive it. */
export interface LiveSource {
  readonly readyState: number
  addEventListener(type: 'open' | 'error', listener: () => void): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  close(): void
}

/** The page's visibility, so tests can drive it. */
export interface LiveVisibility {
  hidden(): boolean
  onChange(listener: () => void): () => void
}

export interface LiveOptions {
  createSource?: (url: string) => LiveSource
  visibility?: LiveVisibility
}

const browserVisibility: LiveVisibility = {
  hidden: () => document.visibilityState === 'hidden',
  onChange: (listener) => {
    document.addEventListener('visibilitychange', listener)
    return () => document.removeEventListener('visibilitychange', listener)
  },
}

/** Starts the stream; returns the function that stops it. */
export function startLive(queryClient: QueryClient, options: LiveOptions = {}): () => void {
  const createSource = options.createSource ?? ((url) => new EventSource(url))
  const visibility = options.visibility ?? browserVisibility
  const store = useLiveStore.getState()
  let source: LiveSource | undefined
  let stopped = false
  let failures = 0
  let missed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  const pending = new Map<string, readonly unknown[]>()

  const flush = () => {
    flushTimer = undefined
    const keys = [...pending.values()]
    pending.clear()
    void invalidateAll(queryClient, ...keys)
  }
  const enqueue = (keys: readonly (readonly unknown[])[]) => {
    for (const key of keys) pending.set(JSON.stringify(key), key)
    flushTimer ??= setTimeout(flush, BATCH_MS)
  }

  const drop = () => {
    source?.close()
    source = undefined
    store.setConnected(false)
    missed = true
  }

  const connect = () => {
    if (stopped || source || visibility.hidden()) return
    const opened = createSource(URL)
    source = opened
    opened.addEventListener('open', () => {
      failures = 0
      store.setConnected(true)
      if (missed) {
        missed = false
        enqueue(liveInvalidations({ type: 'resync' }))
      }
    })
    opened.addEventListener('message', (message) => {
      const event = parseLiveEvent(message.data)
      if (event) enqueue(liveInvalidations(event))
    })
    opened.addEventListener('error', () => {
      store.setConnected(false)
      missed = true
      if (opened.readyState !== CLOSED) return // the browser reconnects by itself
      drop()
      const delay =
        RECONNECT_DELAYS_MS[Math.min(failures, RECONNECT_DELAYS_MS.length - 1)] ?? 60_000
      failures += 1
      reconnectTimer = setTimeout(connect, delay)
    })
  }

  const onVisibility = () => {
    if (visibility.hidden()) {
      hiddenTimer ??= setTimeout(() => {
        hiddenTimer = undefined
        clearTimeout(reconnectTimer)
        drop()
      }, HIDDEN_CLOSE_MS)
      return
    }
    clearTimeout(hiddenTimer)
    hiddenTimer = undefined
    if (!source) {
      clearTimeout(reconnectTimer)
      connect()
    }
  }

  const unwatch = visibility.onChange(onVisibility)
  connect()
  return () => {
    stopped = true
    unwatch()
    clearTimeout(reconnectTimer)
    clearTimeout(hiddenTimer)
    clearTimeout(flushTimer)
    source?.close()
    source = undefined
    store.setConnected(false)
  }
}

/** Keeps the live stream open while the signed-in app is on screen (call it once, from the shell). */
export function useLive(): void {
  const queryClient = useQueryClient()
  useEffect(() => startLive(queryClient), [queryClient])
}

/**
 * How often a query that polled every `fastMs` should poll now: at its old pace while the stream
 * is down, and only as a safety net (`liveMs`) while live updates arrive. TanStack asks after each
 * fetch, so a change of state shows at the next poll at the latest.
 */
export function livePoll(fastMs: number, liveMs = SLOW_POLL_MS): number {
  return useLiveStore.getState().connected ? liveMs : fastMs
}
