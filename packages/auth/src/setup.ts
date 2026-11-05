import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The first-run setup code. A fresh install has no accounts, so whoever reaches the dashboard
 * first could claim it. Setup therefore needs a code that only the person running the server
 * can see: it's printed in the server's log at startup (and by `circi admin setup-code`). It is
 * derived from the instance secret, so every process agrees on it and nothing is stored.
 */
export function setupCode(secret: string): string {
  return createHmac('sha256', secret)
    .update('circi-first-run-setup')
    .digest('base64url')
    .slice(0, 20)
}

export function isSetupCode(secret: string, given: string): boolean {
  const expected = Buffer.from(setupCode(secret))
  const actual = Buffer.from(given.trim())
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
