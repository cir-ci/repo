import { type Database } from '@circi/db'
import { getBuild } from '@circi/db/queries'
import { emitLive, emitWorkspaceAccessLive } from '@circi/db/queue'

export { LIVE_CHANNEL } from '@circi/db/queue'

/**
 * Tells the open dashboards that something changed (see `LiveNotice` in `@circi/core`). Call it
 * in the transaction that makes the change: the notice is delivered on commit and dropped on
 * rollback, like the job notices. One call per change; the payload is IDs only.
 */

/** A build changed (`build.*`), or what its page and the review lists show did (`review.changed`, `comment.changed`). */
export async function emitBuildLive(
  db: Database,
  type:
    | 'build.created'
    | 'build.finalized'
    | 'build.updated'
    | 'review.changed'
    | 'comment.changed',
  build: { projectId: string; number: number },
): Promise<void> {
  await emitLive(db, { type, projectId: build.projectId, build: build.number })
}

/** `emitBuildLive` for a caller that has only the build's ID (comments, review requests). */
export async function emitBuildLiveById(
  db: Database,
  type: Parameters<typeof emitBuildLive>[1],
  buildId: string,
): Promise<void> {
  const build = await getBuild(db, buildId)
  if (build) await emitBuildLive(db, type, build)
}

/** Something changed in a project that no single build owns (triage, a review request's list). */
export async function emitProjectLive(
  db: Database,
  type: 'review.changed' | 'triage.changed',
  projectId: string,
): Promise<void> {
  await emitLive(db, { type, projectId })
}

/** Something changed in one person's inbox. */
export async function emitUserLive(
  db: Database,
  type: 'notification.created' | 'notification.read',
  userId: string,
): Promise<void> {
  await emitLive(db, { type, userId })
}

/** A person's access changed (role, membership): their open streams look at what they may see again at once. */
export async function emitAccessLive(db: Database, userId: string): Promise<void> {
  await emitLive(db, { type: 'access.changed', userId })
}

/** Every member of a workspace's access changed (it was deleted or restored). */
export async function emitWorkspaceAccessChanged(db: Database, workspaceId: string): Promise<void> {
  await emitWorkspaceAccessLive(db, workspaceId)
}
