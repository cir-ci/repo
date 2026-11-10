import type { Undo } from '@circi/api'
import type { UndoToken } from '@circi/services'

/** An action's token as it goes on the wire; null when the action changed nothing. */
export function presentUndo(token: UndoToken | null): Undo.Token | null {
  return token ? { id: token.id, expiresAt: token.expiresAt.toISOString() } : null
}
