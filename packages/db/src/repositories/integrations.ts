import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'

import { integrationProjects, integrations, projects } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError, isUniqueViolation } from '#src/errors.ts'

/**
 * An organisation's integrations (git hosts, Slack, Linear, Jira, Figma) and the projects that use
 * them. Credentials arrive and leave sealed (`sealSecret` in `@circi/core`); nothing here reads
 * them. The git-specific lookups are in `git.ts`.
 */

export namespace OrgIntegration {
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

export namespace createIntegration {
  export interface Input {
    orgId: string
    /** An id from the integration registry (`@circi/integrations`); validated there. */
    kind: string
    displayName: string
    externalId: string
    encryptedCredentials?: string | null
    createdBy?: string | null
  }
}

/** Adds an integration; ConflictError when the organisation already connected that account. */
export async function createIntegration(
  db: Database,
  input: createIntegration.Input,
): Promise<OrgIntegration.Record> {
  try {
    const [row] = await db
      .insert(integrations)
      .values({
        orgId: input.orgId,
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

/** An integration of the organisation (undefined for another organisation's). */
export async function getIntegration(
  db: Database,
  orgId: string,
  integrationId: string,
): Promise<OrgIntegration.Record | undefined> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.orgId, orgId), eq(integrations.id, integrationId)))
  return row
}

/** The organisation's integrations, oldest first, with how many projects use each. */
export async function listIntegrations(db: Database, orgId: string): Promise<OrgIntegration.Row[]> {
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
    .where(eq(integrations.orgId, orgId))
    .groupBy(integrations.id)
    .orderBy(asc(integrations.createdAt), asc(integrations.id))
}

/** Removes an integration and, with it, every project mapping. False when it isn't the organisation's. */
export async function deleteIntegration(
  db: Database,
  orgId: string,
  integrationId: string,
): Promise<boolean> {
  const rows = await db
    .delete(integrations)
    .where(and(eq(integrations.orgId, orgId), eq(integrations.id, integrationId)))
    .returning({ id: integrations.id })
  return rows.length > 0
}

/** Flags (or, with `reason` null, clears) that CirCI can't use the integration. */
export async function setIntegrationAttention(
  db: Database,
  integrationId: string,
  reason: string | null,
): Promise<void> {
  await db
    .update(integrations)
    .set({
      needsAttention: reason !== null,
      needsAttentionReason: reason,
      // The time of the first failure is kept while it keeps failing.
      needsAttentionAt:
        reason === null ? null : sql`coalesce(${integrations.needsAttentionAt}, now())`,
    })
    .where(eq(integrations.id, integrationId))
}

/** Points a project at something in the integration (a channel, team, file); replaces any earlier mapping. */
export async function setIntegrationProject(
  db: Database,
  input: {
    integrationId: string
    projectId: string
    externalRef: string
    extra?: Record<string, unknown>
  },
): Promise<OrgIntegration.Project> {
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

/** The organisation's integration of a kind for an external account, if it connected that one already. */
export async function findIntegrationByExternalId(
  db: Database,
  orgId: string,
  kind: string,
  externalId: string,
): Promise<{ id: string } | undefined> {
  const [row] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(
      and(
        eq(integrations.orgId, orgId),
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

/** Whether another organisation already has a connection to this external account (same kind). */
export async function isAccountClaimedElsewhere(
  db: Database,
  kind: string,
  externalId: string,
  orgId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(
      and(
        eq(integrations.kind, kind),
        eq(integrations.externalId, externalId),
        ne(integrations.orgId, orgId),
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

export namespace listOrgProjectMappings {
  export interface Row {
    slug: string
    name: string
    /** The project's mapping on the integration; null when it has none. */
    mapping: { externalRef: string; extra: Record<string, unknown> } | null
  }
}

/** Every project of the organisation with its mapping (if any) on one integration, by project name. */
export async function listOrgProjectMappings(
  db: Database,
  orgId: string,
  integrationId: string,
): Promise<listOrgProjectMappings.Row[]> {
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
    .where(eq(projects.orgId, orgId))
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
