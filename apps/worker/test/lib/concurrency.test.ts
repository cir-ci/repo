import { afterEach, describe, expect, it, vi } from 'vitest'

import { interruptibleSleep, mapLimit } from '#lib/concurrency.ts'

describe('mapLimit', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs every item, never more than `limit` at once', async () => {
    let inFlight = 0
    let peak = 0
    const done: number[] = []
    vi.useFakeTimers()
    const finished = mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      done.push(n)
    })
    await vi.runAllTimersAsync()
    await finished
    expect(done.toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(peak).toBe(3)
  })

  it('does nothing for no items', async () => {
    const ran: number[] = []
    await mapLimit([], 4, (n: number) => {
      ran.push(n)
      return Promise.resolve()
    })
    expect(ran).toEqual([])
  })

  it('rejects with the first failure', async () => {
    await expect(
      mapLimit([1, 2, 3], 2, (n) =>
        n === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(),
      ),
    ).rejects.toThrow('boom')
  })
})

describe('interruptibleSleep', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sleeps for the time given', async () => {
    vi.useFakeTimers()
    const s = interruptibleSleep()
    let woke = false
    const sleeping = s.sleep(30).then(() => (woke = true))
    await vi.advanceTimersByTimeAsync(29)
    expect(woke).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await sleeping
    expect(woke).toBe(true)
  })

  it('wake() cuts the sleep short', async () => {
    vi.useFakeTimers()
    const s = interruptibleSleep()
    const sleeping = s.sleep(10_000)
    s.wake()
    await sleeping
    expect(vi.getTimerCount()).toBe(0)
  })

  it('wake() with nobody asleep is harmless, and the next sleep still lasts', async () => {
    vi.useFakeTimers()
    const s = interruptibleSleep()
    s.wake()
    let woke = false
    const sleeping = s.sleep(30).then(() => (woke = true))
    await vi.advanceTimersByTimeAsync(29)
    expect(woke).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await sleeping
    expect(woke).toBe(true)
  })
})
