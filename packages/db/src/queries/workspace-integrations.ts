import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import { integrationProjects, integrations, projects } from '#schema/index.ts'
import { projectVisibleTo } from '#shared/project-visibility.ts'
import type { Database } from '#src/client.ts'

/** A workspace's integrations, as read models and the repository both need them. */

export namespace WorkspaceIntegration {
  export type Record = typeof integrations.$inferSelect

  export type Project = typeof integrationProjects.$inferSelect

  export interface Row {
    id: string
    kind: string
    displayName: string
    needsAttention: boolean
    needsAttentionReason: string | null
    createdAt: Date
    projectCount: number
  }
}

/** The workspace's integrations, oldest first, with how many projects use each. */
export async function listIntegrations(
  db: Database,
  workspaceId: string,
): Promise<WorkspaceIntegration.Row[]> {
  return db
    .select({
      id: integrations.id,
      kind: integrations.kind,
      displayName: integrations.displayName,
      needsAttention: integrations.needsAttention,
      needsAttentionReason: integrations.needsAttentionReason,
      createdAt: integrations.createdAt,
      projectCount: sql<number>`count(${integrationProjects.id})::int`,
    })
    .from(integrations)
    .leftJoin(integrationProjects, eq(integrationProjects.integrationId, integrations.id))
    .where(eq(integrations.workspaceId, workspaceId))
    .groupBy(integrations.id)
    .orderBy(asc(integrations.createdAt), asc(integrations.id))
}

/** An integration of the workspace (undefined for another workspace's). */
export async function getIntegration(
  db: Database,
  workspaceId: string,
  integrationId: string,
): Promise<WorkspaceIntegration.Record | undefined> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.id, integrationId)))
  return row
}

export namespace listWorkspaceProjectMappings {
  export interface Row {
    slug: string
    name: string
    /** The project's mapping on the integration; null when it has none. */
    mapping: { externalRef: string; extra: Record<string, unknown> } | null
  }
}

/** Every project of the workspace with its mapping (if any) on one integration, by project name. */
export async function listWorkspaceProjectMappings(
  db: Database,
  workspaceId: string,
  integrationId: string,
  /** Lists only the projects this person may see. */
  viewerId?: string,
): Promise<listWorkspaceProjectMappings.Row[]> {
  const rows = await db
    .select({
      slug: projects.slug,
      name: projects.name,
      externalRef: integrationProjects.externalRef,
      extra: integrationProjects.extra,
    })
    .from(projects)
    .leftJoin(
      integrationProjects,
      and(
        eq(integrationProjects.projectId, projects.id),
        eq(integrationProjects.integrationId, integrationId),
      ),
    )
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        viewerId === undefined ? undefined : projectVisibleTo(viewerId, projects),
      ),
    )
    .orderBy(asc(projects.name), asc(projects.slug))
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    mapping: r.externalRef === null ? null : { externalRef: r.externalRef, extra: r.extra ?? {} },
  }))
}

export namespace listProjectIntegrations {
  /** An integration a project is mapped to, with the mapping. */
  export interface Row {
    integrationId: string
    kind: string
    displayName: string
    /** The mapping's target: a Linear team id, a Jira project key, a Figma file key. */
    externalRef: string
    extra: Record<string, unknown>
    needsAttention: boolean
  }
}

/** The integrations of the given kinds a project is mapped to, oldest first. */
export async function listProjectIntegrations(
  db: Database,
  projectId: string,
  kinds: readonly string[],
): Promise<listProjectIntegrations.Row[]> {
  if (kinds.length === 0) return []
  return db
    .select({
      integrationId: integrations.id,
      kind: integrations.kind,
      displayName: integrations.displayName,
      externalRef: integrationProjects.externalRef,
      extra: integrationProjects.extra,
      needsAttention: integrations.needsAttention,
    })
    .from(integrationProjects)
    .innerJoin(integrations, eq(integrations.id, integrationProjects.integrationId))
    .where(
      and(eq(integrationProjects.projectId, projectId), inArray(integrations.kind, [...kinds])),
    )
    .orderBy(asc(integrations.createdAt), asc(integrations.id))
}
