import { sql } from 'drizzle-orm'

import { userPreferences } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * Stores the workspace a person opened last, and says whether that changed anything: opening
 * the workspace that is already remembered writes nothing. One statement, so it needs no
 * transaction. The caller has checked that the person belongs to the workspace.
 */
export async function rememberLastWorkspace(
  db: Database,
  input: { userId: string; workspaceId: string },
): Promise<{ changed: boolean }> {
  const written = await db
    .insert(userPreferences)
    .values({ userId: input.userId, lastWorkspaceId: input.workspaceId })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { lastWorkspaceId: input.workspaceId, updatedAt: sql`now()` },
      setWhere: sql`${userPreferences.lastWorkspaceId} is distinct from ${input.workspaceId}`,
    })
    .returning({ userId: userPreferences.userId })
  return { changed: written.length > 0 }
}
