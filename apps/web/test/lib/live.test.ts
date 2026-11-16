import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BATCH_MS,
  HIDDEN_CLOSE_MS,
  livePoll,
  type LiveSource,
  type LiveVisibility,
  RECONNECT_DELAYS_MS,
  SLOW_POLL_MS,
  startLive,
} from '#lib/live.ts'
import { keys } from '#lib/query-keys.ts'
import { useLiveStore } from '#lib/stores/live-store.ts'

/** A stand-in for `EventSource` the test drives by hand. */
class FakeSource implements LiveSource {
  static all: FakeSource[] = []
  readyState = 0
  closed = false
  private listeners: Record<string, ((event: { data: unknown }) => void)[]> = {}
  constructor(readonly url: string) {
    FakeSource.all.push(this)
  }
  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    ;(this.listeners[type] ??= []).push(listener)
  }
  close() {
    this.closed = true
    this.readyState = 2
  }
  open() {
    this.readyState = 1
    for (const l of this.listeners.open ?? []) l({ data: undefined })
  }
  send(event: object) {
    for (const l of this.listeners.message ?? []) l({ data: JSON.stringify(event) })
  }
  /** The browser gave up (an HTTP error) or is retrying by itself. */
  fail(giveUp: boolean) {
    this.readyState = giveUp ? 2 : 0
    for (const l of this.listeners.error ?? []) l({ data: undefined })
  }
}

function fakeVisibility() {
  let hidden = false
  const listeners = new Set<() => void>()
  const visibility: LiveVisibility = {
    hidden: () => hidden,
    onChange: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
  return {
    visibility,
    set(value: boolean) {
      hidden = value
      for (const l of listeners) l()
    },
    listeners,
  }
}

function last(): FakeSource {
  const source = FakeSource.all.at(-1)
  if (!source) throw new Error('no source was opened')
  return source
}

/** A query client whose invalidations are recorded. */
function recordingClient() {
  const client = new QueryClient()
  const invalidated: (readonly unknown[])[] = []
  vi.spyOn(client, 'invalidateQueries').mockImplementation((filters) => {
    invalidated.push(filters?.queryKey ?? [])
    return Promise.resolve()
  })
  return { client, invalidated }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSource.all = []
  useLiveStore.getState().reset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('startLive', () => {
  it('opens /api/live, and is connected once it opens', () => {
    const { client } = recordingClient()
    const stop = startLive(client, {
      createSource: (url) => new FakeSource(url),
      visibility: fakeVisibility().visibility,
    })
    expect(last().url).toBe('/api/live')
    expect(useLiveStore.getState().connected).toBe(false)
    last().open()
    expect(useLiveStore.getState().connected).toBe(true)
    stop()
    expect(useLiveStore.getState().connected).toBe(false)
    expect(last().closed).toBe(true)
  })

  it('invalidates what an event makes stale, once, after the burst', () => {
    const { client, invalidated } = recordingClient()
    startLive(client, {
      createSource: (url) => new FakeSource(url),
      visibility: fakeVisibility().visibility,
    })
    last().open()
    const event = { workspace: 'acme', project: 'web', build: 7 }
    last().send({ type: 'build.updated', ...event })
    last().send({ type: 'review.changed', ...event })
    last().send({ type: 'build.updated', ...event })
    expect(invalidated).toEqual([])
    vi.advanceTimersByTime(BATCH_MS)
    expect(invalidated).toContainEqual(keys.build('acme', 'web', 7))
    expect(invalidated).toContainEqual(keys.reviews())
    // The shared keys of three events went out once each.
    expect(
      invalidated.filter((k) => JSON.stringify(k) === JSON.stringify(keys.build('acme', 'web', 7))),
    ).toHaveLength(1)
    invalidated.length = 0
    vi.advanceTimersByTime(10 * BATCH_MS)
    expect(invalidated).toEqual([])
  })

  it('ignores a message that is not an event', () => {
    const { client, invalidated } = recordingClient()
    startLive(client, {
      createSource: (url) => new FakeSource(url),
      visibility: fakeVisibility().visibility,
    })
    last().open()
    last().send({ type: 'from.the.future' })
    vi.advanceTimersByTime(BATCH_MS)
    expect(invalidated).toEqual([])
  })

  it('leaves reconnecting to the browser while it retries, and catches up everything when it is back', () => {
    const { client, invalidated } = recordingClient()
    startLive(client, {
      createSource: (url) => new FakeSource(url),
      visibility: fakeVisibility().visibility,
    })
    last().open()
    vi.advanceTimersByTime(BATCH_MS)
    expect(invalidated).toEqual([]) // the first open needs no catch-up
    last().fail(false)
    expect(useLiveStore.getState().connected).toBe(false)
    expect(FakeSource.all).toHaveLength(1)
    last().open()
    expect(useLiveStore.getState().connected).toBe(true)
    vi.advanceTimersByTime(BATCH_MS)
    expect(invalidated).toEqual([[]])
  })

  it('reconnects itself with a growing delay when the browser gives up, and starts over once it opens', () => {
    const { client, invalidated } = recordingClient()
    startLive(client, {
      createSource: (url) => new FakeSource(url),
      visibility: fakeVisibility().visibility,
    })
    last().fail(true) // 503: the server has no feed
    expect(FakeSource.all).toHaveLength(1)
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0] ?? 0)
    expect(FakeSource.all).toHaveLength(2)
    last().fail(true)
    vi.advanceTimersByTime((RECONNECT_DELAYS_MS[1] ?? 0) - 1)
    expect(FakeSource.all).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSource.all).toHaveLength(3)
    last().open()
    vi.advanceTimersByTime(BATCH_MS)
    expect(invalidated).toEqual([[]])
    last().fail(true)
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0] ?? 0)
    expect(FakeSource.all).toHaveLength(4)
  })

  it('stops growing the delay at the last step', () => {
    const { client } = recordingClient()
    startLive(client, {
      createSource: (url) => new FakeSource(url),
      visibility: fakeVisibility().visibility,
    })
    for (let i = 0; i < RECONNECT_DELAYS_MS.length + 3; i += 1) {
      last().fail(true)
      vi.advanceTimersByTime(RECONNECT_DELAYS_MS.at(-1) ?? 0)
    }
    expect(FakeSource.all).toHaveLength(RECONNECT_DELAYS_MS.length + 4)
  })

  it('keeps the stream through a short hidden spell, and closes it, then catches up, after a long one', () => {
    const { client, invalidated } = recordingClient()
    const page = fakeVisibility()
    startLive(client, { createSource: (url) => new FakeSource(url), visibility: page.visibility })
    last().open()
    page.set(true)
    vi.advanceTimersByTime(HIDDEN_CLOSE_MS - 1)
    page.set(false)
    expect(last().closed).toBe(false)
    vi.advanceTimersByTime(HIDDEN_CLOSE_MS * 2)
    expect(last().closed).toBe(false)
    expect(invalidated).toEqual([])

    page.set(true)
    vi.advanceTimersByTime(HIDDEN_CLOSE_MS)
    expect(last().closed).toBe(true)
    expect(useLiveStore.getState().connected).toBe(false)
    page.set(false)
    expect(FakeSource.all).toHaveLength(2)
    last().open()
    vi.advanceTimersByTime(BATCH_MS)
    expect(invalidated).toEqual([[]])
  })

  it('does not open while the tab is hidden, and opens when it is shown', () => {
    const { client } = recordingClient()
    const page = fakeVisibility()
    page.set(true)
    startLive(client, { createSource: (url) => new FakeSource(url), visibility: page.visibility })
    expect(FakeSource.all).toHaveLength(0)
    page.set(false)
    expect(FakeSource.all).toHaveLength(1)
  })

  it('stops for good: no timer, no listener, no new source', () => {
    const { client, invalidated } = recordingClient()
    const page = fakeVisibility()
    const stop = startLive(client, {
      createSource: (url) => new FakeSource(url),
      visibility: page.visibility,
    })
    last().fail(true)
    last().send({ type: 'build.updated' })
    stop()
    vi.advanceTimersByTime(HIDDEN_CLOSE_MS * 2)
    expect(FakeSource.all).toHaveLength(1)
    expect(page.listeners.size).toBe(0)
    expect(invalidated).toEqual([])
  })
})

describe('livePoll', () => {
  it('polls at the old pace while the stream is down, and only as a safety net while it is up', () => {
    expect(livePoll(3_000)).toBe(3_000)
    useLiveStore.getState().setConnected(true)
    expect(livePoll(3_000)).toBe(SLOW_POLL_MS)
    expect(livePoll(60_000, 300_000)).toBe(300_000)
  })
})
