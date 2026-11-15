import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'

import { type WorkspaceIntegration } from '#queries/workspace-integrations.ts'
import { integrationProjects, integrations, projects } from '#schema/index.ts'
import { type FlaggedConnection, flaggedConnectionColumns } from '#shared/flagged-connection.ts'
import type { Database } from '#src/client.ts'
import { ConflictError, isUniqueViolation } from '#src/errors.ts'

/**
 * A workspace's integrations (git hosts, Slack, Linear, Jira, Figma) and the projects that use
 * them. Credentials arrive and leave sealed (`sealSecret` in `@circi/core`); nothing here reads
 * them. The git-specific lookups are in `git.ts`.
 */

export namespace createIntegration {
  export interface Input {
    workspaceId: string
    /** An id from the integration registry (`@circi/integrations`); validated there. */
    kind: string
    displayName: string
    externalId: string
    encryptedCredentials?: string | null
    createdBy?: string | null
  }
}

/** Adds an integration; ConflictError when the workspace already connected that account. */
export async function createIntegration(
  db: Database,
  input: createIntegration.Input,
): Promise<WorkspaceIntegration.Record> {
  try {
    const [row] = await db
      .insert(integrations)
      .values({
        workspaceId: input.workspaceId,
        kind: input.kind,
        displayName: input.displayName,
        externalId: input.externalId,
        encryptedCredentials: input.encryptedCredentials ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning()
    if (!row) throw new Error('insert returned no row')
    return row
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError('This account is already connected')
    throw err
  }
}

/** Removes an integration and, with it, every project mapping. False when it isn't the workspace's. */
export async function deleteIntegration(
  db: Database,
  workspaceId: string,
  integrationId: string,
): Promise<boolean> {
  const rows = await db
    .delete(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.id, integrationId)))
    .returning({ id: integrations.id })
  return rows.length > 0
}

/**
 * Flags (or, with `reason` null, clears) that CirCI can't use the integration. Returns the
 * connection when it just went from working to flagged (undefined otherwise), so the caller can
 * tell people once per failure.
 */
export async function setIntegrationAttention(
  db: Database,
  integrationId: string,
  reason: string | null,
): Promise<FlaggedConnection | undefined> {
  if (reason === null) {
    await db
      .update(integrations)
      .set({ needsAttention: false, needsAttentionReason: null, needsAttentionAt: null })
      .where(eq(integrations.id, integrationId))
    return undefined
  }
  const first = await db
    .update(integrations)
    .set({
      needsAttention: true,
      needsAttentionReason: reason,
      needsAttentionAt: sql`now()`,
    })
    .where(and(eq(integrations.id, integrationId), eq(integrations.needsAttention, false)))
    .returning(flaggedConnectionColumns)
  if (first[0]) return first[0]
  // Already flagged: the time of the first failure stays, the reason may be newer.
  await db
    .update(integrations)
    .set({ needsAttentionReason: reason })
    .where(eq(integrations.id, integrationId))
  return undefined
}
/** Points a project at something in the integration (a channel, project, file); replaces any earlier mapping. */
export async function setIntegrationProject(
  db: Database,
  input: {
    integrationId: string
    projectId: string
    externalRef: string
    extra?: Record<string, unknown>
  },
): Promise<WorkspaceIntegration.Project> {
  const [row] = await db
    .insert(integrationProjects)
    .values({
      integrationId: input.integrationId,
      projectId: input.projectId,
      externalRef: input.externalRef,
      extra: input.extra ?? {},
    })
    .onConflictDoUpdate({
      target: [integrationProjects.integrationId, integrationProjects.projectId],
      set: { externalRef: input.externalRef, extra: input.extra ?? {} },
    })
    .returning()
  if (!row) throw new Error('upsert returned no row')
  return row
}

export async function removeIntegrationProject(
  db: Database,
  integrationId: string,
  projectId: string,
): Promise<void> {
  await db
    .delete(integrationProjects)
    .where(
      and(
        eq(integrationProjects.integrationId, integrationId),
        eq(integrationProjects.projectId, projectId),
      ),
    )
}

/** The projects mapped to an integration, by project name. */
export async function listIntegrationProjects(
  db: Database,
  integrationId: string,
): Promise<
  {
    projectId: string
    slug: string
    name: string
    externalRef: string
    extra: Record<string, unknown>
  }[]
> {
  return db
    .select({
      projectId: projects.id,
      slug: projects.slug,
      name: projects.name,
      externalRef: integrationProjects.externalRef,
      extra: integrationProjects.extra,
    })
    .from(integrationProjects)
    .innerJoin(projects, eq(projects.id, integrationProjects.projectId))
    .where(eq(integrationProjects.integrationId, integrationId))
    .orderBy(asc(projects.name), asc(projects.slug))
}

/** The workspace's integration of a kind for an external account, if it connected that one already. */
export async function findIntegrationByExternalId(
  db: Database,
  workspaceId: string,
  kind: string,
  externalId: string,
): Promise<{ id: string } | undefined> {
  const [row] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(
      and(
        eq(integrations.workspaceId, workspaceId),
        eq(integrations.kind, kind),
        eq(integrations.externalId, externalId),
      ),
    )
  return row
}

/** Stores fresh credentials for an integration (a reinstall) and clears "needs attention". */
export async function replaceIntegrationCredentials(
  db: Database,
  integrationId: string,
  input: { displayName: string; encryptedCredentials: string | null },
): Promise<void> {
  await db
    .update(integrations)
    .set({
      displayName: input.displayName,
      encryptedCredentials: input.encryptedCredentials,
      needsAttention: false,
      needsAttentionReason: null,
      needsAttentionAt: null,
    })
    .where(eq(integrations.id, integrationId))
}

/** Whether another workspace already has a connection to this external account (same kind). */
export async function isAccountClaimedElsewhere(
  db: Database,
  kind: string,
  externalId: string,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(
      and(
        eq(integrations.kind, kind),
        eq(integrations.externalId, externalId),
        ne(integrations.workspaceId, workspaceId),
      ),
    )
    .limit(1)
  return row !== undefined
}

/**
 * Drops the project's mappings on integrations of the given kinds other than `keepIntegrationId`:
 * what "a project maps to one connection" means (mapping to a second moves it). Returns the
 * integrations it stopped using.
 */
export async function removeOtherProjectMappings(
  db: Database,
  input: { projectId: string; keepIntegrationId: string; kinds: readonly string[] },
): Promise<string[]> {
  if (input.kinds.length === 0) return []
  const rows = await db
    .delete(integrationProjects)
    .where(
      and(
        eq(integrationProjects.projectId, input.projectId),
        ne(integrationProjects.integrationId, input.keepIntegrationId),
        inArray(
          integrationProjects.integrationId,
          db
            .select({ id: integrations.id })
            .from(integrations)
            .where(inArray(integrations.kind, [...input.kinds])),
        ),
      ),
    )
    .returning({ integrationId: integrationProjects.integrationId })
  return rows.map((r) => r.integrationId)
}

/** An integration with the project's mapping, sealed credentials included; undefined if the project is not mapped to it. */
export async function getProjectIntegration(
  db: Database,
  projectId: string,
  integrationId: string,
): Promise<
  | {
      integration: typeof integrations.$inferSelect
      externalRef: string
      extra: Record<string, unknown>
    }
  | undefined
> {
  const [row] = await db
    .select({
      integration: integrations,
      externalRef: integrationProjects.externalRef,
      extra: integrationProjects.extra,
    })
    .from(integrationProjects)
    .innerJoin(integrations, eq(integrations.id, integrationProjects.integrationId))
    .where(
      and(
        eq(integrationProjects.projectId, projectId),
        eq(integrationProjects.integrationId, integrationId),
      ),
    )
  return row
}
