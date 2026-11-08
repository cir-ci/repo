import { DEFAULT_FLAKY_BLOCKS_MERGE } from '@circi/core'
import { eq } from 'drizzle-orm'

import { workspaceSettings } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** A workspace's defaults for its teams (a team may override each one). */

export interface WorkspaceSettings {
  /** Whether a pull request that only changes flaky screenshots still blocks the merge. */
  flakyBlocksMerge: boolean
}

const DEFAULTS: WorkspaceSettings = { flakyBlocksMerge: DEFAULT_FLAKY_BLOCKS_MERGE }

/** The workspace's settings; the defaults when it has never saved any. */
export async function getWorkspaceSettings(
  db: Database,
  workspaceId: string,
): Promise<WorkspaceSettings> {
  const [row] = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
  return row ? { flakyBlocksMerge: row.flakyBlocksMerge } : DEFAULTS
}

/** Saves the given settings only and returns them all. */
export async function setWorkspaceSettings(
  db: Database,
  workspaceId: string,
  patch: Partial<WorkspaceSettings>,
): Promise<WorkspaceSettings> {
  const next = { ...(await getWorkspaceSettings(db, workspaceId)), ...patch }
  await db
    .insert(workspaceSettings)
    .values({ workspaceId, ...next })
    .onConflictDoUpdate({
      target: workspaceSettings.workspaceId,
      set: { ...next, updatedAt: new Date() },
    })
  return next
}
