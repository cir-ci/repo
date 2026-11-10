import { and, eq, isNull, lt, ne, or } from 'drizzle-orm'

import { type UndoKind, undoActions } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * The record of what an action changed, for taking it back (see `undoActions`). Data only: what
 * each kind restores, and whether it still can be, is in the services next to the action.
 */

export type { UndoKind }
export type UndoAction = typeof undoActions.$inferSelect

export async function createUndoAction(
  db: Database,
  input: {
    userId: string
    teamId: string | null
    kind: UndoKind
    data: Record<string, unknown>
    expiresAt: Date
  },
): Promise<UndoAction> {
  const [row] = await db.insert(undoActions).values(input).returning()
  if (!row) throw new Error('insert returned no row')
  return row
}

/** One action, locked until the transaction ends so two undos of it can't both run. */
export async function lockUndoAction(db: Database, id: string): Promise<UndoAction | undefined> {
  const [row] = await db.select().from(undoActions).where(eq(undoActions.id, id)).for('update')
  return row
}

export async function markUndoUsed(db: Database, id: string, at: Date): Promise<void> {
  await db.update(undoActions).set({ usedAt: at }).where(eq(undoActions.id, id))
}

/**
 * Deletes the actions whose window has closed (retention). A used `build_review` row stays: a
 * build's activity lists it as "undid approving". Returns how many rows went.
 */
export async function purgeExpiredUndoActions(db: Database, now: Date): Promise<number> {
  const gone = await db
    .delete(undoActions)
    .where(
      and(
        lt(undoActions.expiresAt, now),
        or(isNull(undoActions.usedAt), ne(undoActions.kind, 'build_review')),
      ),
    )
    .returning({ id: undoActions.id })
  return gone.length
}
