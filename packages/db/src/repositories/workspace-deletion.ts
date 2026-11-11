import { workspacePurgeCutoff } from '@circi/core'
import { eq, inArray, lte, sql } from 'drizzle-orm'

import {
  apikey,
  builds,
  integrations,
  notifications,
  projects,
  webhooks,
  workspace,
  workspaceDeletions,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import type { Job } from '#src/types.ts'

/**
 * Soft deletion of workspaces. A workspace is deleted by a row in `workspace_deletions`; the
 * member-facing lookups hide it through `workspaceAccepts` (see `auth-settings.ts`). Purging
 * removes the workspace row for good, and the schema's cascades take everything under it. Data
 * only: who may delete, and the files that follow, are `@circi/services`.
 */

/** Marks the workspace deleted at `now`. False when it already was (the first time stands). */
export async function markWorkspaceDeleted(
  db: Database,
  input: { workspaceId: string; deletedBy: string | null; now: Date },
): Promise<boolean> {
  const rows = await db
    .insert(workspaceDeletions)
    .values({ workspaceId: input.workspaceId, deletedBy: input.deletedBy, deletedAt: input.now })
    .onConflictDoNothing()
    .returning({ id: workspaceDeletions.workspaceId })
  return rows.length > 0
}

/** Brings a deleted workspace back; false when it was not deleted. */
export async function clearWorkspaceDeletion(db: Database, workspaceId: string): Promise<boolean> {
  const rows = await db
    .delete(workspaceDeletions)
    .where(eq(workspaceDeletions.workspaceId, workspaceId))
    .returning({ id: workspaceDeletions.workspaceId })
  return rows.length > 0
}

/** When the workspace was deleted; undefined while it is live. */
export async function getWorkspaceDeletedAt(
  db: Database,
  workspaceId: string,
): Promise<Date | undefined> {
  const [row] = await db
    .select({ at: workspaceDeletions.deletedAt })
    .from(workspaceDeletions)
    .where(eq(workspaceDeletions.workspaceId, workspaceId))
  return row?.at
}

/** Workspaces whose purge is due at `now` (deleted at least the grace period ago). */
export async function listWorkspaceIdsDueForPurge(db: Database, now: Date): Promise<string[]> {
  // The same boundary as `isWorkspacePurgeDue`: deleted_at + 30 days <= now.
  const cutoff = workspacePurgeCutoff(now)
  const rows = await db
    .select({ id: workspaceDeletions.workspaceId })
    .from(workspaceDeletions)
    .where(lte(workspaceDeletions.deletedAt, cutoff))
  return rows.map((r) => r.id)
}

/**
 * Deletes the workspace row, and with it (cascading) its projects, builds, screenshots, members,
 * integrations and settings; and its CI tokens, which better-auth keys by workspace without a
 * foreign key. Only a workspace that is marked deleted. Written directly, not through
 * better-auth's `deleteOrganization`, because the job has no session to act as.
 */
export async function purgeWorkspaceRows(db: Database, workspaceId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [marked] = await tx
      .select({ id: workspaceDeletions.workspaceId })
      .from(workspaceDeletions)
      .where(eq(workspaceDeletions.workspaceId, workspaceId))
      .for('update')
    if (!marked) return false
    await tx.delete(apikey).where(eq(apikey.referenceId, workspaceId))
    await tx.delete(workspace).where(eq(workspace.id, workspaceId))
    return true
  })
}

/** Which of these builds belong to a deleted workspace. */
export async function buildsInDeletedWorkspaces(
  db: Database,
  buildIds: string[],
): Promise<Set<string>> {
  if (buildIds.length === 0) return new Set()
  const rows = await db
    .select({ id: builds.id })
    .from(builds)
    .innerJoin(projects, eq(projects.id, builds.projectId))
    .innerJoin(workspaceDeletions, eq(workspaceDeletions.workspaceId, projects.workspaceId))
    .where(inArray(builds.id, buildIds))
  return new Set(rows.map((r) => r.id))
}

/**
 * Whether the job is for something inside a deleted workspace (found through the build,
 * webhook, integration or notification it names), so the worker can drop it.
 */
export async function jobIsForDeletedWorkspace(db: Database, job: Job): Promise<boolean> {
  const p = job.payload
  const str = (key: string) => (typeof p[key] === 'string' ? p[key] : undefined)
  const buildId = str('buildId')
  const webhookId = str('webhookId')
  const integrationId = str('integrationId')
  const notificationId = str('notificationId')
  const deleted = db.select({ one: sql`1` }).from(workspaceDeletions)
  if (buildId) {
    const [row] = await deleted
      .innerJoin(projects, eq(projects.workspaceId, workspaceDeletions.workspaceId))
      .innerJoin(builds, eq(builds.projectId, projects.id))
      .where(eq(builds.id, buildId))
    return row !== undefined
  }
  if (webhookId) {
    const [row] = await deleted
      .innerJoin(projects, eq(projects.workspaceId, workspaceDeletions.workspaceId))
      .innerJoin(webhooks, eq(webhooks.projectId, projects.id))
      .where(eq(webhooks.id, webhookId))
    return row !== undefined
  }
  if (integrationId) {
    const [row] = await deleted
      .innerJoin(integrations, eq(integrations.workspaceId, workspaceDeletions.workspaceId))
      .where(eq(integrations.id, integrationId))
    return row !== undefined
  }
  if (notificationId) {
    const [row] = await deleted
      .innerJoin(projects, eq(projects.workspaceId, workspaceDeletions.workspaceId))
      .innerJoin(builds, eq(builds.projectId, projects.id))
      .innerJoin(notifications, eq(notifications.buildId, builds.id))
      .where(eq(notifications.id, notificationId))
    return row !== undefined
  }
  return false
}
