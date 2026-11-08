import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'

import { integrationTeams, integrations, teams } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError, isUniqueViolation } from '#src/errors.ts'

/**
 * A workspace's integrations (git hosts, Slack, Linear, Jira, Figma) and the teams that use
 * them. Credentials arrive and leave sealed (`sealSecret` in `@circi/core`); nothing here reads
 * them. The git-specific lookups are in `git.ts`.
 */

export namespace WorkspaceIntegration {
  export type Record = typeof integrations.$inferSelect

  export type Team = typeof integrationTeams.$inferSelect

  export interface Row {
    id: string
    kind: string
    displayName: string
    needsAttention: boolean
    needsAttentionReason: string | null
    createdAt: Date
    teamCount: number
  }
}

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

/** The workspace's integrations, oldest first, with how many teams use each. */
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
      teamCount: sql<number>`count(${integrationTeams.id})::int`,
    })
    .from(integrations)
    .leftJoin(integrationTeams, eq(integrationTeams.integrationId, integrations.id))
    .where(eq(integrations.workspaceId, workspaceId))
    .groupBy(integrations.id)
    .orderBy(asc(integrations.createdAt), asc(integrations.id))
}

/** Removes an integration and, with it, every team mapping. False when it isn't the workspace's. */
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

/** Points a team at something in the integration (a channel, team, file); replaces any earlier mapping. */
export async function setIntegrationTeam(
  db: Database,
  input: {
    integrationId: string
    teamId: string
    externalRef: string
    extra?: Record<string, unknown>
  },
): Promise<WorkspaceIntegration.Team> {
  const [row] = await db
    .insert(integrationTeams)
    .values({
      integrationId: input.integrationId,
      teamId: input.teamId,
      externalRef: input.externalRef,
      extra: input.extra ?? {},
    })
    .onConflictDoUpdate({
      target: [integrationTeams.integrationId, integrationTeams.teamId],
      set: { externalRef: input.externalRef, extra: input.extra ?? {} },
    })
    .returning()
  if (!row) throw new Error('upsert returned no row')
  return row
}

export async function removeIntegrationTeam(
  db: Database,
  integrationId: string,
  teamId: string,
): Promise<void> {
  await db
    .delete(integrationTeams)
    .where(
      and(eq(integrationTeams.integrationId, integrationId), eq(integrationTeams.teamId, teamId)),
    )
}

/** The teams mapped to an integration, by team name. */
export async function listIntegrationTeams(
  db: Database,
  integrationId: string,
): Promise<
  {
    teamId: string
    slug: string
    name: string
    externalRef: string
    extra: Record<string, unknown>
  }[]
> {
  return db
    .select({
      teamId: teams.id,
      slug: teams.slug,
      name: teams.name,
      externalRef: integrationTeams.externalRef,
      extra: integrationTeams.extra,
    })
    .from(integrationTeams)
    .innerJoin(teams, eq(teams.id, integrationTeams.teamId))
    .where(eq(integrationTeams.integrationId, integrationId))
    .orderBy(asc(teams.name), asc(teams.slug))
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
 * Drops the team's mappings on integrations of the given kinds other than `keepIntegrationId`:
 * what "a team maps to one connection" means (mapping to a second moves it). Returns the
 * integrations it stopped using.
 */
export async function removeOtherTeamMappings(
  db: Database,
  input: { teamId: string; keepIntegrationId: string; kinds: readonly string[] },
): Promise<string[]> {
  if (input.kinds.length === 0) return []
  const rows = await db
    .delete(integrationTeams)
    .where(
      and(
        eq(integrationTeams.teamId, input.teamId),
        ne(integrationTeams.integrationId, input.keepIntegrationId),
        inArray(
          integrationTeams.integrationId,
          db
            .select({ id: integrations.id })
            .from(integrations)
            .where(inArray(integrations.kind, [...input.kinds])),
        ),
      ),
    )
    .returning({ integrationId: integrationTeams.integrationId })
  return rows.map((r) => r.integrationId)
}

export namespace listWorkspaceTeamMappings {
  export interface Row {
    slug: string
    name: string
    /** The team's mapping on the integration; null when it has none. */
    mapping: { externalRef: string; extra: Record<string, unknown> } | null
  }
}

/** Every team of the workspace with its mapping (if any) on one integration, by team name. */
export async function listWorkspaceTeamMappings(
  db: Database,
  workspaceId: string,
  integrationId: string,
): Promise<listWorkspaceTeamMappings.Row[]> {
  const rows = await db
    .select({
      slug: teams.slug,
      name: teams.name,
      externalRef: integrationTeams.externalRef,
      extra: integrationTeams.extra,
    })
    .from(teams)
    .leftJoin(
      integrationTeams,
      and(eq(integrationTeams.teamId, teams.id), eq(integrationTeams.integrationId, integrationId)),
    )
    .where(eq(teams.workspaceId, workspaceId))
    .orderBy(asc(teams.name), asc(teams.slug))
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    mapping: r.externalRef === null ? null : { externalRef: r.externalRef, extra: r.extra ?? {} },
  }))
}

export namespace listTeamIntegrations {
  /** An integration a team is mapped to, with the mapping. */
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

/** The integrations of the given kinds a team is mapped to, oldest first. */
export async function listTeamIntegrations(
  db: Database,
  teamId: string,
  kinds: readonly string[],
): Promise<listTeamIntegrations.Row[]> {
  if (kinds.length === 0) return []
  return db
    .select({
      integrationId: integrations.id,
      kind: integrations.kind,
      displayName: integrations.displayName,
      externalRef: integrationTeams.externalRef,
      extra: integrationTeams.extra,
      needsAttention: integrations.needsAttention,
    })
    .from(integrationTeams)
    .innerJoin(integrations, eq(integrations.id, integrationTeams.integrationId))
    .where(and(eq(integrationTeams.teamId, teamId), inArray(integrations.kind, [...kinds])))
    .orderBy(asc(integrations.createdAt), asc(integrations.id))
}

/** An integration with the team's mapping, sealed credentials included; undefined if the team is not mapped to it. */
export async function getTeamIntegration(
  db: Database,
  teamId: string,
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
      externalRef: integrationTeams.externalRef,
      extra: integrationTeams.extra,
    })
    .from(integrationTeams)
    .innerJoin(integrations, eq(integrations.id, integrationTeams.integrationId))
    .where(
      and(eq(integrationTeams.teamId, teamId), eq(integrationTeams.integrationId, integrationId)),
    )
  return row
}
