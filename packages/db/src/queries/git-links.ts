import { and, eq, inArray } from 'drizzle-orm'

import type { CONNECTION_ATTENTION } from '#schema/enums.ts'
import { integrationProjects, integrations } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** A project's git connection: its repository mapping and whether the connection still works. */

/** The ids of the integration kinds that are git hosts. */
export type GitKinds = readonly string[]

export interface GitLink {
  /** The connection's external id (the GitHub App installation id). */
  installationId: string
  repoRef: string
}

export namespace getProjectGitAttention {
  /** What the dashboard shows when CirCI can't use a project's git connection. */
  export interface Attention {
    reason: getProjectGitAttention.Kind
    since: Date
  }

  /** Why a connection needs a person's attention. */
  export type Kind = (typeof CONNECTION_ATTENTION)[number]
}

/** Whether CirCI can't use the project's git connection; undefined when it works or there is none. */
export async function getProjectGitAttention(
  db: Database,
  projectId: string,
  kinds: GitKinds,
): Promise<getProjectGitAttention.Attention | undefined> {
  const mapping = await getGitMapping(db, projectId, kinds)
  const since = mapping?.integration.needsAttentionAt
  if (!mapping?.integration.needsAttention || !since) return undefined
  return { reason: 'installation_revoked', since }
}

/** A project's mapping on one of its git connections: the connection and the repository. */
export async function getGitMapping(db: Database, projectId: string, kinds: GitKinds) {
  if (kinds.length === 0) return undefined
  const [row] = await db
    .select({
      integration: integrations,
      repoRef: integrationProjects.externalRef,
    })
    .from(integrationProjects)
    .innerJoin(integrations, eq(integrations.id, integrationProjects.integrationId))
    .where(
      and(eq(integrationProjects.projectId, projectId), inArray(integrations.kind, [...kinds])),
    )
    .orderBy(integrationProjects.createdAt)
    .limit(1)
  return row
}

export async function getProjectLink(
  db: Database,
  projectId: string,
  kinds: GitKinds,
): Promise<GitLink | undefined> {
  const mapping = await getGitMapping(db, projectId, kinds)
  return mapping
    ? { installationId: mapping.integration.externalId, repoRef: mapping.repoRef }
    : undefined
}
