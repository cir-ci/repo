import type { Database } from '@circi/db'
import { createUndoAction, type UndoKind } from '@circi/db/repositories'

/** How long a person has to take an action back. */
export const UNDO_WINDOW_MS = 30_000

/** What the caller of an action gets to undo it with. */
export interface UndoToken {
  id: string
  expiresAt: Date
}

/**
 * Writes down what an action did, in the action's own transaction, so a token exists exactly when
 * the change does. `data` is what the kind's undo needs (the state before, and what was set).
 */
export async function recordUndo(
  db: Database,
  input: {
    userId: string
    /** The project the undo route is scoped to; null for the person's own inbox. */
    projectId: string | null
    kind: UndoKind
    data: object
    now?: Date
  },
): Promise<UndoToken> {
  const row = await createUndoAction(db, {
    userId: input.userId,
    projectId: input.projectId,
    kind: input.kind,
    data: { ...input.data },
    expiresAt: new Date((input.now ?? new Date()).getTime() + UNDO_WINDOW_MS),
  })
  return { id: row.id, expiresAt: row.expiresAt }
}
