import { vi } from 'vitest'

/** The instant fixed clocks start at. */
export const T0 = new Date('2026-06-01T12:00:00.000Z')

export namespace fixedClock {
  export interface Result {
    /** The current fake time. */
    readonly now: Date
    /** Moves the fake time forward. */
    tick(ms: number): void
    /** The instant `ms` before now. */
    ago(ms: number): Date
    /** Back to the real clock. */
    restore(): void
  }
}

/**
 * Freezes `Date` (and only `Date`: timers keep running, so `setTimeout` and polling still
 * work) at `at`. Call `restore()` in `afterEach`; `setup-node.ts` also restores real timers.
 */
export function fixedClock(at: Date = T0): fixedClock.Result {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at)
  return {
    get now() {
      return new Date()
    },
    tick(ms) {
      vi.setSystemTime(new Date(Date.now() + ms))
    },
    ago(ms) {
      return new Date(Date.now() - ms)
    },
    restore() {
      vi.useRealTimers()
    },
  }
}
