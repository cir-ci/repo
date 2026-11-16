import { useQueryClient } from '@tanstack/react-query'

import { authClient } from '#lib/auth-client.ts'
import { purgePersisted } from '#lib/query-persist.ts'

/**
 * Signs out and forgets everything fetched as this person (in memory and the stored cache), so
 * the next one never sees it. The purge runs even when the sign-out request fails: the person
 * asked to leave, and what is kept here is theirs.
 */
export function useSignOut(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    try {
      await authClient.signOut()
    } finally {
      // Also the installed app's tabs and the recent visits and searches (purgePersisted).
      await purgePersisted()
      queryClient.clear()
    }
  }
}
