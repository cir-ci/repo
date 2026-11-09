import { assertRetentionDays } from '@circi/core'

import { type WorkspaceSettings, getWorkspaceSettings } from '#queries/workspace-settings.ts'
import { workspaceSettings } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** A workspace's defaults for its teams (a team may override each one). */

/** Saves the given settings only and returns them all. */
export async function setWorkspaceSettings(
  db: Database,
  workspaceId: string,
  patch: Partial<WorkspaceSettings>,
): Promise<WorkspaceSettings> {
  if (patch.retentionDays !== undefined) assertRetentionDays(patch.retentionDays)
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
