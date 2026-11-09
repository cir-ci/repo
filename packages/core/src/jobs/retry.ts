/** How long a failed job waits before its next attempt: exponential, capped. */
export interface RetryBackoff {
  /** The wait after the first failed attempt; each further wait doubles. */
  baseMs: number
  /** No wait is longer than this. */
  maxMs: number
}

/** 2 s, 4 s, 8 s, ... capped at 5 minutes. */
export const DEFAULT_RETRY_BACKOFF: RetryBackoff = { baseMs: 2_000, maxMs: 300_000 }

/** The wait after the `attempts`-th attempt (1 for the first) failed. */
export function retryDelayMs(attempts: number, backoff: RetryBackoff = DEFAULT_RETRY_BACKOFF) {
  return Math.min(backoff.maxMs, backoff.baseMs * 2 ** Math.max(0, attempts - 1))
}
