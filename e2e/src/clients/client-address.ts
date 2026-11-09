let counter = 0

/**
 * A client address nobody else in this run has used. better-auth's rate limits (3 requests per
 * 10 s to sign in, 3 per minute to ask for or try an emailed code, per endpoint) are keyed on the
 * client address, and every request from the test machine otherwise comes from one address, so
 * tests would trip over each other's counts. The limit per email address (5 codes per 15 minutes)
 * is separate and unaffected.
 */
export function freshIp(): string {
  counter += 1
  const run = Math.floor(Math.random() * 250) + 1
  return `10.${run}.${Math.floor(counter / 250) % 250}.${(counter % 250) + 1}`
}

/**
 * The one place that says how a test client tells the server its address: the header a reverse
 * proxy would set. Every request the harness makes on behalf of a person (a `Session`, a browser
 * context, a raw call to `/api/auth`) goes through this. How much the server trusts that header is
 * the stack's configuration (see `compose.yml`), not something the tests decide.
 */
export function clientAddressHeaders(address: string): Record<string, string> {
  return { 'x-forwarded-for': address }
}
