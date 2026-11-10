import type { Workspace } from '@circi/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { instancePath } from '#lib/api-paths.ts'
import { post } from '#lib/http.ts'
import { keys } from '#lib/query-keys.ts'

/** Checks the setup code on its own (the first step); the server answers 403 for a wrong one. */
export const checkSetupCode = (code: string) => post<undefined>('/api/setup/code', { code })

/** Creates the first account and its workspace as one request: either both exist afterwards, or neither. */
export const submitSetup = (input: {
  code: string
  name: string
  email: string
  password: string
  workspaceName: string
  workspaceSlug: string
}) => post<{ email: string; workspace: { slug: string } }>('/api/setup', input)

/**
 * Ends the setup steps (finished or skipped). The cached capabilities say so at once, so the app
 * opens without waiting for another round trip.
 */
export function useFinishSetup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => post<undefined>(instancePath('setup', 'finish'), {}),
    onSuccess: () => {
      queryClient.setQueryData<Workspace.Capabilities>(keys.capabilities(), (caps) =>
        caps ? { ...caps, setupPending: false } : caps,
      )
      return queryClient.invalidateQueries({ queryKey: keys.capabilities() })
    },
  })
}
