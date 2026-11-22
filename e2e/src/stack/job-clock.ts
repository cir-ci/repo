/**
 * The scaled-down job clock for the stacks of tests that wait on retries: the worker waits
 * `retryBaseMs` before the second attempt (production: 2 s) and doubles from there, and gives a
 * receiver `receiverTimeoutMs` to answer (production: 10 s). A test asks for the profile instead
 * of carrying the numbers (`useStack({ dedicated: true, env: FAST_JOB_CLOCK.env })`), and states
 * its expectations in terms of `retryBaseMs`. It needs a stack of its own: the tests that must
 * see the real schedule share a stack with the production clock.
 */
export const FAST_JOB_CLOCK = {
  retryBaseMs: 500,
  receiverTimeoutMs: 2_000,
  /** Environment for the circi container. */
  env: {
    JOB_RETRY_BASE_SECONDS: '0.5',
    WEBHOOK_TIMEOUT_SECONDS: '2',
  },
} as const
