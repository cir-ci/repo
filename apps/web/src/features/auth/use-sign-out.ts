import { useQueryClient } from '@tanstack/react-query'

import { authClient } from '#lib/auth-client.ts'

/** Signs out and forgets everything fetched as this person, so the next one never sees it. */
export function useSignOut(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await authClient.signOut()
    queryClient.clear()
  }
}
