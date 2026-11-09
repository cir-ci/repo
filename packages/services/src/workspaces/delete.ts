import { isWorkspacePurgeDue } from '@circi/core'
import { ConflictError, type Database, NotFoundError } from '@circi/db'
import { getMemberRole } from '@circi/db/queries'
import {
  clearWorkspaceDeletion,
  getWorkspaceDeletedAt,
  listWorkspaceIdsDueForPurge,
  markUnreferencedFiles,
  markWorkspaceDeleted,
  purgeWorkspaceRows,
} from '@circi/db/repositories'

/**
 * Deleting a workspace. Soft first: `deleteWorkspace` hides it at once (every member-facing
 * lookup treats it as missing, uploads and CI tokens stop working, the worker drops its jobs),
 * and it can be restored by an instance admin for 30 days. After that `purgeDueWorkspaces`
 * (called by retention) removes its rows, and the files nothing points at any more are marked
 * for the usual collection.
 */

export class WorkspaceDeleteForbiddenError extends Error {
  constructor() {
    super('Only an owner can delete the workspace')
    this.name = 'WorkspaceDeleteForbiddenError'
  }
}

/**
 * Deletes (hides) a workspace for its owner. The typed confirmation must be the workspace's
 * name, which the caller checks against the name it loaded. Members and admins may not.
 */
export async function deleteWorkspace(
  db: Database,
  input: { workspaceId: string; userId: string; now?: Date },
): Promise<{ deletedAt: Date }> {
  const role = await getMemberRole(db, { userId: input.userId, workspaceId: input.workspaceId })
  if (role !== 'owner') throw new WorkspaceDeleteForbiddenError()
  const now = input.now ?? new Date()
  return db.transaction(async (tx) => {
    await markWorkspaceDeleted(tx, { workspaceId: input.workspaceId, deletedBy: input.userId, now })
    const deletedAt = await getWorkspaceDeletedAt(tx, input.workspaceId)
    return { deletedAt: deletedAt ?? now }
  })
}

/** Brings a deleted workspace back, with everything in it. */
export async function restoreWorkspace(db: Database, workspaceId: string): Promise<void> {
  if (!(await db.transaction((tx) => clearWorkspaceDeletion(tx, workspaceId)))) {
    throw new ConflictError('This workspace is not deleted')
  }
}

/**
 * Purges one deleted workspace now (an instance admin's "delete permanently now"), or only when
 * its grace period is over with `onlyIfDue`. Then queues its files for collection: the ones
 * nothing points at any more are marked, and the collection step deletes them after its grace.
 */
export async function purgeWorkspace(
  db: Database,
  input: { workspaceId: string; now?: Date; onlyIfDue?: boolean },
): Promise<void> {
  const now = input.now ?? new Date()
  const deletedAt = await getWorkspaceDeletedAt(db, input.workspaceId)
  if (!deletedAt) throw new NotFoundError('This workspace is not deleted')
  if (input.onlyIfDue && !isWorkspacePurgeDue(deletedAt, now)) return
  await db.transaction(async (tx) => {
    await purgeWorkspaceRows(tx, input.workspaceId)
    await markUnreferencedFiles(tx, now)
  })
}

/** Purges every deleted workspace whose 30 days are over; returns how many. */
export async function purgeDueWorkspaces(db: Database, now: Date): Promise<number> {
  const due = await listWorkspaceIdsDueForPurge(db, now)
  let purged = 0
  for (const workspaceId of due) {
    // eslint-disable-next-line no-await-in-loop -- one workspace at a time, each in its own transaction
    if (await db.transaction((tx) => purgeWorkspaceRows(tx, workspaceId))) purged += 1
  }
  return purged
}
