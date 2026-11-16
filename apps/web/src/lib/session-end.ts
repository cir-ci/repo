import { authClient } from '#lib/auth-client.ts'
import { purgePersisted } from '#lib/query-persist.ts'

/** Several requests answer 401 together: one check covers them all. */
let checking = false

/**
 * A request got a 401: the session ended (expired, revoked, or signed out in another tab). Drops
 * the stored query cache and the remembered person at once, so nothing of theirs is drawn again,
 * and asks the server whether the session is still there, then lets the app fall back to the
 * sign-in page by itself.
 *
 * The check skips better-auth's cookie cache: that copy of the session is believed for up to
 * `SESSION_COOKIE_CACHE_SECONDS` after a revoke, so a plain re-check would still answer "signed in"
 * and the person would sit on error pages until it ran out. Asking the database also makes the
 * server delete the stale cookies.
 */
export function sessionEnded(): void {
  void purgePersisted()
  if (checking) return
  checking = true
  void authClient
    .getSession({ query: { disableCookieCache: true } })
    .catch(() => undefined)
    .finally(() => {
      checking = false
      authClient.$store.notify('$sessionSignal')
    })
}
