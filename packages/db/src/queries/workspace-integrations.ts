import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import { integrationTeams, integrations, teams } from '#schema/index.ts'
import { teamVisibleTo } from '#shared/team-visibility.ts'
import type { Database } from '#src/client.ts'

/** A workspace's integrations, as read models and the repository both need them. */

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
  /** Lists only the teams this person may see. */
  viewerId?: string,
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
    .where(
      and(
        eq(teams.workspaceId, workspaceId),
        viewerId === undefined ? undefined : teamVisibleTo(viewerId, teams),
      ),
    )
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
