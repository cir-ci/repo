import type { Database } from '@circi/db'
import { rememberLastWorkspace } from '@circi/db/repositories'

/**
 * Remembers that `userId` opened `workspaceId`, so every device opens it next. A plain preference
 * write: the caller has already checked that the person is a member of the workspace and that it
 * accepts how they signed in. Writes only when the value changes; returns whether it did.
 */
export async function rememberWorkspace(
  db: Database,
  input: { userId: string; workspaceId: string },
): Promise<{ changed: boolean }> {
  return rememberLastWorkspace(db, input)
}
