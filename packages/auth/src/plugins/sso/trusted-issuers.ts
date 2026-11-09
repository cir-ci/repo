import type { Database } from '@circi/db'
import { schema } from '@circi/db'

/**
 * better-auth only talks to origins it trusts. A workspace's identity provider is, by
 * design, somewhere we don't know in advance, so the trusted origins are the issuers already
 * registered (read per request, so every server process agrees), plus, for the length of one
 * registration, the issuer being registered (`withTrustedIssuer`). The route that registers has
 * already checked the address and the caller's rights.
 */

export function trustedOriginsFor(db: Database): () => Promise<string[]> {
  return async () => {
    // better-auth asks while it starts up, which on a new database is before the migrations
    // have created the table. Nothing is registered yet then, and later requests ask again.
    const rows = await db
      .select({ issuer: schema.ssoProvider.issuer })
      .from(schema.ssoProvider)
      .catch(() => [])
    const origins = new Set<string>()
    for (const { issuer } of rows) {
      try {
        origins.add(new URL(issuer).origin)
      } catch {
        // A malformed issuer can't be trusted for anything.
      }
    }
    return [...origins]
  }
}

/** Runs `run` with the issuer's origin trusted, then withdraws that trust again. */
export async function withTrustedIssuer<T>(
  auth: { $context: Promise<{ trustedOrigins: string[] }> },
  issuer: string,
  run: () => Promise<T>,
): Promise<T> {
  const context = await auth.$context
  const origin = new URL(issuer).origin
  context.trustedOrigins.push(origin)
  try {
    return await run()
  } finally {
    const at = context.trustedOrigins.lastIndexOf(origin)
    if (at >= 0) context.trustedOrigins.splice(at, 1)
  }
}
