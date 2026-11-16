import { authClient } from '#lib/auth-client.ts'
import { purgePersisted } from '#lib/query-persist.ts'

/**
 * A request got a 401: the session ended (expired, or signed out in another tab). Re-check it,
 * and the app falls back to the sign-in page by itself; and drop the stored query cache and the
 * remembered person at once, so nothing of theirs is drawn again.
 */
export function sessionEnded(): void {
  authClient.$store.notify('$sessionSignal')
  void purgePersisted()
}
