import { and, eq, sql } from 'drizzle-orm'

import { account, member, projects, providerConnections } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

export const GITLAB_KIND = 'gitlab'

/**
 * Records a GitLab connection of the organisation: the token's principal (`externalId`, see
 * `gitlabExternalId`) with its sealed credentials. Connecting the same principal again replaces
 * the credentials (a rotated token) and clears a needs-attention mark.
 */
export async function connectGitlab(
  db: Database,
  orgId: string,
  externalId: string,
  encryptedCredentials: string,
): Promise<{ id: string }> {
  const [connection] = await db
    .insert(providerConnections)
    .values({ orgId, kind: 'gitlab', externalId, encryptedCredentials })
    .onConflictDoUpdate({
      target: [providerConnections.orgId, providerConnections.kind, providerConnections.externalId],
      set: { encryptedCredentials, needsAttention: null, needsAttentionAt: null },
    })
    .returning({ id: providerConnections.id })
  if (!connection) throw new Error('upsert returned no row')
  return connection
}

/**
 * Points a project at a repository through one of its organisation's connections (any host that
 * works with tokens). False when the connection is not the organisation's, or the project is not.
 */
export async function linkProjectToGitlab(
  db: Database,
  orgId: string,
  projectSlug: string,
  link: { connectionId: string; repoRef: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [connection] = await tx
      .select({ id: providerConnections.id, kind: providerConnections.kind })
      .from(providerConnections)
      .where(
        and(eq(providerConnections.orgId, orgId), eq(providerConnections.id, link.connectionId)),
      )
    if (connection?.kind !== GITLAB_KIND) return false
    const updated = await tx
      .update(projects)
      .set({ providerConnectionId: connection.id, repoRef: link.repoRef })
      .where(and(eq(projects.slug, projectSlug), eq(projects.orgId, orgId)))
      .returning({ id: projects.id })
    if (updated.length === 0) return false
    await tx
      .update(providerConnections)
      .set({ needsAttention: null, needsAttentionAt: null })
      .where(eq(providerConnections.id, connection.id))
    return true
  })
}

export namespace findProjectsByHostRepo {
  export interface Row {
    id: string
    orgId: string
    connectionId: string
    encryptedCredentials: string | null
  }
}

/**
 * Projects linked to a repository on a host, for webhooks that name the repository but not the
 * connection (GitLab): `externalIdPrefix` is the host part of the connection's external id
 * (`gitlab.example.com#`). Compared case-insensitively, like `findProjectsByRepo`.
 */
export async function findProjectsByHostRepo(
  db: Database,
  kind: string,
  externalIdPrefix: string,
  repoRef: string,
): Promise<findProjectsByHostRepo.Row[]> {
  return db
    .select({
      id: projects.id,
      orgId: projects.orgId,
      connectionId: providerConnections.id,
      encryptedCredentials: providerConnections.encryptedCredentials,
    })
    .from(projects)
    .innerJoin(providerConnections, eq(providerConnections.id, projects.providerConnectionId))
    .where(
      and(
        eq(providerConnections.kind, kind),
        sql`starts_with(${providerConnections.externalId}, ${externalIdPrefix})`,
        sql`lower(${projects.repoRef}) = ${repoRef.toLowerCase()}`,
      ),
    )
}

/**
 * The CirCI user a host account is, when they signed in or linked with that provider (matched by
 * the provider's numeric user id, never by email) and belong to the project's organization.
 * `providerId` is better-auth's, e.g. `github`, `gitlab`.
 */
export async function findMemberByProviderAccount(
  db: Database,
  providerId: string,
  providerUserId: string,
  projectId: string,
): Promise<string | undefined> {
  const rows = await db
    .select({ userId: account.userId })
    .from(account)
    .innerJoin(projects, eq(projects.id, projectId))
    .innerJoin(
      member,
      and(eq(member.userId, account.userId), eq(member.organizationId, projects.orgId)),
    )
    .where(and(eq(account.providerId, providerId), eq(account.accountId, providerUserId)))
  return rows[0]?.userId
}

export namespace listGitlabProjectLinks {
  export interface Row {
    slug: string
    name: string
    /** Null unless the project reports to GitLab. */
    repoRef: string | null
    connectionId: string | null
  }
}

/** Each of the organisation's projects with the GitLab project it reports to, if any. */
export async function listGitlabProjectLinks(
  db: Database,
  orgId: string,
): Promise<listGitlabProjectLinks.Row[]> {
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
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    repoRef: r.kind === GITLAB_KIND ? r.repoRef : null,
    connectionId: r.kind === GITLAB_KIND ? r.connectionId : null,
  }))
}

/** Stops a project reporting (to whatever it reports to). False when the organisation has no such project. */
export async function unlinkGitlabProject(
  db: Database,
  orgId: string,
  projectSlug: string,
): Promise<boolean> {
  const rows = await db
    .update(projects)
    .set({ providerConnectionId: null, repoRef: null })
    .where(and(eq(projects.orgId, orgId), eq(projects.slug, projectSlug)))
    .returning({ id: projects.id })
  return rows.length > 0
}
