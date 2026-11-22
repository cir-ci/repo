import { onTestFinished, vi } from 'vitest'

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
 * The two kinds of fake clock:
 *
 *  - `fixedClock` (the default): freezes `Date` only. Timers, `setTimeout` and polling keep
 *    running for real, so a test can wait on real I/O at a fixed instant.
 *  - `fakeTimers`: fakes the timers too (`setTimeout`, `setInterval`, `Date`...), which you move
 *    by hand with `advance`. For code that waits on timers (backoff, shutdown timeouts, sleeps).
 *    It restores the real clock when the test ends, whether it passed or threw, so no `try/finally`.
 *
 * Both import only `vitest`, so browser tests can use them too.
 */

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

export namespace fakeTimers {
  export interface Result {
    /** Moves the fake time forward, running every timer that falls due on the way. */
    advance(ms: number): Promise<void>
    /** Runs every pending timer (and the ones they set) to the end. */
    runAll(): Promise<void>
    /** How many timers are waiting. */
    pending(): number
    /** Back to the real clock early (it is restored when the test ends anyway). */
    restore(): void
  }
}

/** Fakes `Date` and every timer, starting at `at`; restored when the current test ends. */
export function fakeTimers(at: Date = T0): fakeTimers.Result {
  vi.useFakeTimers()
  vi.setSystemTime(at)
  onTestFinished(() => {
    vi.useRealTimers()
  })
  return {
    advance: async (ms) => {
      await vi.advanceTimersByTimeAsync(ms)
    },
    runAll: async () => {
      await vi.runAllTimersAsync()
    },
    pending: () => vi.getTimerCount(),
    restore: () => vi.useRealTimers(),
  }
}
