import { and, eq, inArray } from 'drizzle-orm'

import type { CONNECTION_ATTENTION } from '#schema/enums.ts'
import { integrationTeams, integrations } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** A team's git connection: its repository mapping and whether the connection still works. */

/** The ids of the integration kinds that are git hosts. */
export type GitKinds = readonly string[]

export interface GitLink {
  /** The connection's external id (the GitHub App installation id). */
  installationId: string
  repoRef: string
}

export namespace getTeamGitAttention {
  /** What the dashboard shows when CirCI can't use a team's git connection. */
  export interface Attention {
    reason: getTeamGitAttention.Kind
    since: Date
  }

  /** Why a connection needs a person's attention. */
  export type Kind = (typeof CONNECTION_ATTENTION)[number]
}

/** Whether CirCI can't use the team's git connection; undefined when it works or there is none. */
export async function getTeamGitAttention(
  db: Database,
  teamId: string,
  kinds: GitKinds,
): Promise<getTeamGitAttention.Attention | undefined> {
  const mapping = await getGitMapping(db, teamId, kinds)
  const since = mapping?.integration.needsAttentionAt
  if (!mapping?.integration.needsAttention || !since) return undefined
  return { reason: 'installation_revoked', since }
}

/** A team's mapping on one of its git connections: the connection and the repository. */
export async function getGitMapping(db: Database, teamId: string, kinds: GitKinds) {
  if (kinds.length === 0) return undefined
  const [row] = await db
    .select({
      integration: integrations,
      repoRef: integrationTeams.externalRef,
    })
    .from(integrationTeams)
    .innerJoin(integrations, eq(integrations.id, integrationTeams.integrationId))
    .where(and(eq(integrationTeams.teamId, teamId), inArray(integrations.kind, [...kinds])))
    .orderBy(integrationTeams.createdAt)
    .limit(1)
  return row
}

export async function getTeamLink(
  db: Database,
  teamId: string,
  kinds: GitKinds,
): Promise<GitLink | undefined> {
  const mapping = await getGitMapping(db, teamId, kinds)
  return mapping
    ? { installationId: mapping.integration.externalId, repoRef: mapping.repoRef }
    : undefined
}
