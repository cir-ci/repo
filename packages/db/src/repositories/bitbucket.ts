import { and, eq, isNull, or, sql } from 'drizzle-orm'

import { builds, projects, providerConnections } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { NotFoundError } from '#src/errors.ts'

/**
 * Bitbucket Cloud connections (PLAN §7.4): one `provider_connections` row per workspace
 * (`external_id` is the workspace slug) holding the sealed access token, and the lookups its
 * webhook route needs. Credentials arrive sealed (`sealSecret` in `@circi/core`).
 */

export const BITBUCKET_KIND = 'bitbucket'

/**
 * Records that an organisation uses a Bitbucket workspace, with its sealed credentials. Connecting
 * again replaces the credentials and clears a needs-attention mark (a new token after a revoked one).
 */
export async function connectBitbucket(
  db: Database,
  input: { orgId: string; workspace: string; encryptedCredentials: string },
): Promise<{ id: string }> {
  const [connection] = await db
    .insert(providerConnections)
    .values({
      orgId: input.orgId,
      kind: BITBUCKET_KIND,
      externalId: input.workspace,
      encryptedCredentials: input.encryptedCredentials,
    })
    .onConflictDoUpdate({
      target: [providerConnections.orgId, providerConnections.kind, providerConnections.externalId],
      set: {
        encryptedCredentials: input.encryptedCredentials,
        needsAttention: null,
        needsAttentionAt: null,
      },
    })
    .returning({ id: providerConnections.id })
  if (!connection) throw new Error('upsert returned no row')
  return connection
}

/** Points a project at a repository (`workspace/repo`) through one of the organisation's Bitbucket connections. */
export async function linkProjectToBitbucket(
  db: Database,
  input: { orgId: string; projectSlug: string; connectionId: string; repoRef: string },
): Promise<void> {
  const [connection] = await db
    .select({ id: providerConnections.id })
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.id, input.connectionId),
        eq(providerConnections.orgId, input.orgId),
        eq(providerConnections.kind, BITBUCKET_KIND),
      ),
    )
  if (!connection) throw new NotFoundError('Integration not found')
  const rows = await db
    .update(projects)
    .set({ providerConnectionId: connection.id, repoRef: input.repoRef })
    .where(and(eq(projects.orgId, input.orgId), eq(projects.slug, input.projectSlug)))
    .returning({ id: projects.id })
  if (rows.length === 0) throw new NotFoundError('Project not found')
}

/** Stops a project reporting to Bitbucket; false when it isn't the organisation's or reports elsewhere. */
export async function unlinkBitbucketProject(
  db: Database,
  orgId: string,
  projectSlug: string,
): Promise<boolean> {
  const rows = await db
    .update(projects)
    .set({ providerConnectionId: null, repoRef: null })
    .where(
      and(
        eq(projects.orgId, orgId),
        eq(projects.slug, projectSlug),
        sql`${projects.providerConnectionId} in (select ${providerConnections.id} from ${providerConnections} where ${providerConnections.kind} = ${BITBUCKET_KIND})`,
      ),
    )
    .returning({ id: projects.id })
  return rows.length > 0
}

export namespace findBitbucketProjects {
  export interface Row {
    id: string
    orgId: string
    /** The connection's sealed credentials, to answer on the pull request. */
    encryptedCredentials: string | null
  }
}

/** Projects linked to a repository through a Bitbucket workspace (compared case-insensitively). */
export async function findBitbucketProjects(
  db: Database,
  workspace: string,
  repoRef: string,
): Promise<findBitbucketProjects.Row[]> {
  return db
    .select({
      id: projects.id,
      orgId: projects.orgId,
      encryptedCredentials: providerConnections.encryptedCredentials,
    })
    .from(projects)
    .innerJoin(providerConnections, eq(providerConnections.id, projects.providerConnectionId))
    .where(
      and(
        eq(providerConnections.kind, BITBUCKET_KIND),
        sql`lower(${providerConnections.externalId}) = ${workspace.toLowerCase()}`,
        sql`lower(${projects.repoRef}) = ${repoRef.toLowerCase()}`,
      ),
    )
}

/**
 * Gives builds a pull request number the host now knows: builds of the project that don't have
 * one yet and were made for this commit or for the pull request's source branch. Returns how many
 * builds changed.
 */
export async function linkBuildsToPullRequest(
  db: Database,
  input: { projectId: string; prNumber: number; commitSha?: string; branch?: string },
): Promise<number> {
  const matches = [
    ...(input.commitSha ? [eq(builds.commitSha, input.commitSha)] : []),
    ...(input.branch ? [eq(builds.branch, input.branch)] : []),
  ]
  if (matches.length === 0) return 0
  const rows = await db
    .update(builds)
    .set({ prNumber: input.prNumber })
    .where(and(eq(builds.projectId, input.projectId), isNull(builds.prNumber), or(...matches)))
    .returning({ id: builds.id })
  return rows.length
}

export namespace listBitbucketProjectLinks {
  export interface Row {
    slug: string
    name: string
    /** Null unless the project reports to Bitbucket. */
    repoRef: string | null
    connectionId: string | null
  }
}

/** Each of the organisation's projects with the Bitbucket repository it reports to, if any. */
export async function listBitbucketProjectLinks(
  db: Database,
  orgId: string,
): Promise<listBitbucketProjectLinks.Row[]> {
  const rows = await db
    .select({
      slug: projects.slug,
      name: projects.name,
      repoRef: projects.repoRef,
      connectionId: providerConnections.id,
      kind: providerConnections.kind,
    })
    .from(projects)
    .leftJoin(providerConnections, eq(providerConnections.id, projects.providerConnectionId))
    .where(eq(projects.orgId, orgId))
    .orderBy(projects.name, projects.slug)
  return rows.map(({ kind, ...r }) => {
    if (kind === BITBUCKET_KIND) return r
    r.repoRef = null
    r.connectionId = null
    return r
  })
}
