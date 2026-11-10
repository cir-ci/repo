import type { Undo } from '@circi/api'
import type { QueryClient } from '@tanstack/react-query'

import { inboxPath, teamPath } from '#lib/api-paths.ts'
import { post } from '#lib/http.ts'
import type { ToastInput } from '#lib/stores/toast-store.ts'

/** Whose undo it is: a team's actions (`workspace`, `team`), or the inbox's (`null`). */
export type UndoScope = { workspace: string; team: string } | null

/**
 * The toast for a change the server can take back: `message`, with Undo when the answer carried a
 * token (none: the action changed nothing, so the toast only says so). Undo asks the server to
 * revert it, which it does unless something newer changed the same thing (the toast then says
 * so), and refreshes what the change touched.
 */
export function withUndo(
  message: string,
  undo: Undo.Token | null,
  scope: UndoScope,
  refresh: () => Promise<unknown>,
  undoFailed?: string,
): ToastInput {
  if (!undo) return { message }
  const path = scope
    ? teamPath(scope.workspace, scope.team, 'undo', undo.id)
    : inboxPath('undo', undo.id)
  return {
    message,
    undo: async () => {
      await post(path, {})
      await refresh()
    },
    ...(undoFailed ? { undoFailed } : {}),
  }
}

/** After an undo from a page, everything cached is refetched: the page knows what it changed, this just covers it. */
export const refreshAll = (queryClient: QueryClient) => () => queryClient.invalidateQueries()
