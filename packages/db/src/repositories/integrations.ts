import { and, asc, eq, sql } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { ConflictError, isUniqueViolation } from '../errors.ts'
import {
  type INTEGRATION_KINDS,
  integrationProjects,
  integrations,
  projects,
} from '../schema/index.ts'

/**
 * An organisation's non-git integrations (Slack, Linear, Jira, Figma) and the projects that use
 * them. Git hosts are `provider_connections` (see `git.ts`). Credentials arrive and leave sealed
 * (`sealSecret` in `@circi/core`); nothing here reads them.
 */

export type IntegrationRecord = typeof integrations.$inferSelect
export type IntegrationProject = typeof integrationProjects.$inferSelect

export interface NewIntegration {
  orgId: string
  kind: (typeof INTEGRATION_KINDS)[number]
  displayName: string
  externalId: string
  encryptedCredentials?: string | null
  createdBy?: string | null
}

/** Adds an integration; ConflictError when the organisation already connected that account. */
export async function createIntegration(
  db: Database,
  input: NewIntegration,
): Promise<IntegrationRecord> {
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
): Promise<IntegrationRecord | undefined> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.orgId, orgId), eq(integrations.id, integrationId)))
  return row
}

export interface IntegrationRow {
  id: string
  kind: string
  displayName: string
  needsAttention: boolean
  needsAttentionReason: string | null
  createdAt: Date
  projectCount: number
}

/** The organisation's integrations, oldest first, with how many projects use each. */
export async function listIntegrations(db: Database, orgId: string): Promise<IntegrationRow[]> {
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
    .set({ needsAttention: reason !== null, needsAttentionReason: reason })
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
): Promise<IntegrationProject> {
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
