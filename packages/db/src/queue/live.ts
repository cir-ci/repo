import { encodeLiveNotice, type LiveNotice } from '@circi/core'
import { eq, sql } from 'drizzle-orm'

import { member, projects } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** The Postgres channel every server instance LISTENs on for live updates; the payload is a `LiveNotice`. */
export const LIVE_CHANNEL = 'circi_live'

/**
 * Sends `NOTIFY circi_live, '<notice>'`. Like `notifyJobs`, Postgres delivers it when the
 * surrounding transaction commits and drops it on rollback, so a dashboard hears about a change
 * only once the change is visible. Identical notices of one transaction arrive once. A notice
 * about a project that doesn't name its workspace gets it here, so streams can skip the
 * workspaces their person isn't in.
 */
export async function emitLive(db: Database, notice: LiveNotice): Promise<void> {
  let full = notice
  if ('projectId' in notice && notice.workspaceId === undefined) {
    const [row] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, notice.projectId))
    if (row) full = { ...notice, workspaceId: row.workspaceId }
  }
  await db.execute(sql`select pg_notify(${LIVE_CHANNEL}, ${encodeLiveNotice(full)})`)
}

/** Tells every member of a workspace to look at what they may see again (the workspace was deleted or changed hands): one statement, one notice each. */
export async function emitWorkspaceAccessLive(db: Database, workspaceId: string): Promise<void> {
  await db.execute(
    sql`select pg_notify(${LIVE_CHANNEL}, json_build_object('t', 'access.changed', 'u', ${member.userId})::text) from ${member} where ${member.workspaceId} = ${workspaceId}`,
  )
}
