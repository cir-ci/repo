import { type Database } from '@circi/db'
import {
  dismissPublicUrlChange,
  setWorkspaceAuthSettings,
  setWorkspaceSettings,
} from '@circi/db/repositories'

import { autoAssignWorkspace } from '#src/triage/auto-assign.ts'

/** Changes a workspace's defaults for its teams (flaky gate, retention); returns the result. */
export async function updateWorkspaceSettings(
  db: Database,
  workspaceId: string,
  patch: Parameters<typeof setWorkspaceSettings>[2],
): Promise<Awaited<ReturnType<typeof setWorkspaceSettings>>> {
  return db.transaction(async (tx) => {
    const saved = await setWorkspaceSettings(tx, workspaceId, patch)
    // Turned on: every team that follows the default assigns what is waiting.
    if (patch.assignTriageToOnCall) await autoAssignWorkspace(tx, workspaceId)
    return saved
  })
}

/**
 * Changes a workspace's login-method switches; refuses a change that would leave every owner
 * unable to sign in. Returns the settings now in force.
 */
export async function updateWorkspaceSignIn(
  db: Database,
  workspaceId: string,
  patch: Parameters<typeof setWorkspaceAuthSettings>[2],
  options: Parameters<typeof setWorkspaceAuthSettings>[3],
): Promise<Awaited<ReturnType<typeof setWorkspaceAuthSettings>>> {
  return db.transaction((tx) => setWorkspaceAuthSettings(tx, workspaceId, patch, options))
}

/** Dismisses the instance admins' "the public address changed" notice. */
export async function dismissPublicUrlNotice(db: Database): Promise<void> {
  await db.transaction((tx) => dismissPublicUrlChange(tx))
}
