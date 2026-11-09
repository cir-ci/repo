import { vi } from 'vitest'

/** A fixed "now" for tests that compute "N minutes ago": same instant everywhere, no drift. */
export const T0 = new Date('2026-06-01T12:00:00.000Z')

export interface FixedClock {
  readonly now: Date
  /** Moves the clock forward. */
  tick(ms: number): void
  /** The instant `ms` before the clock's now. */
  ago(ms: number): Date
  restore(): void
}

/**
 * Pins `Date` (and only `Date`: `setTimeout`, polling and animation frames stay real, so
 * `expect.element` and `expect.poll` keep working) at `at`. `setup.ts` restores real timers after
 * each test.
 */
export function fixedClock(at: Date = T0): FixedClock {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at)
  return {
    get now() {
      return new Date()
    },
    tick: (ms) => {
      vi.setSystemTime(Date.now() + ms)
    },
    ago: (ms) => new Date(Date.now() - ms),
    restore: () => {
      vi.useRealTimers()
    },
  }
}
