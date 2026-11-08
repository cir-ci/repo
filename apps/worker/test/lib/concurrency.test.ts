import { describe, expect, it } from 'vitest'

import { interruptibleSleep, mapLimit } from '#lib/concurrency.ts'

describe('mapLimit', () => {
  it('runs every item, never more than `limit` at once', async () => {
    let inFlight = 0
    let peak = 0
    const done: number[] = []
    await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      done.push(n)
    })
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
  it('sleeps for the time given', async () => {
    const s = interruptibleSleep()
    const start = Date.now()
    await s.sleep(30)
    expect(Date.now() - start).toBeGreaterThanOrEqual(25)
  })

  it('wake() cuts the sleep short', async () => {
    const s = interruptibleSleep()
    const start = Date.now()
    const sleeping = s.sleep(10_000)
    s.wake()
    await sleeping
    expect(Date.now() - start).toBeLessThan(1_000)
  })

  it('wake() with nobody asleep is harmless, and the next sleep still lasts', async () => {
    const s = interruptibleSleep()
    s.wake()
    const start = Date.now()
    await s.sleep(30)
    expect(Date.now() - start).toBeGreaterThanOrEqual(25)
  })
})
