import { describe, expect, it } from 'vitest'

import { DEFAULT_RETRY_BACKOFF, retryDelayMs } from '../src/index.ts'

describe('retryDelayMs', () => {
  it('keeps the production schedule: 2 s, 4 s, 8 s ... capped at 5 minutes', () => {
    expect([1, 2, 3, 4, 7].map((n) => retryDelayMs(n))).toEqual([
      2_000, 4_000, 8_000, 16_000, 128_000,
    ])
    expect(retryDelayMs(9)).toBe(300_000)
    expect(retryDelayMs(30)).toBe(DEFAULT_RETRY_BACKOFF.maxMs)
  })

  it('scales with the configured base and cap', () => {
    const fast = { baseMs: 250, maxMs: 1_000 }
    expect([1, 2, 3, 4, 5].map((n) => retryDelayMs(n, fast))).toEqual([
      250, 500, 1_000, 1_000, 1_000,
    ])
  })
})
