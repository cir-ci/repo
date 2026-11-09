import { ValidationError } from '@circi/core'

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
  if (
    patch.retentionDays !== undefined &&
    (!Number.isInteger(patch.retentionDays) || patch.retentionDays < 1)
  ) {
    throw new ValidationError('Retention must be at least 1 day')
  }
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
