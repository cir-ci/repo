import { and, desc, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'

import { CONNECTION_ATTENTION } from '#schema/enums.ts'
import {
  account,
  buildChecks,
  builds,
  member,
  organization,
  prComments,
  projects,
  providerConnections,
  providerDeliveries,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { NotFoundError } from '#src/errors.ts'
import type { Build } from '#src/types.ts'

import { enqueueJob } from './jobs.ts'

/**
 * Git host integration (PLAN §7.4): which projects report to which repository, the jobs that
 * push build state to it, and the bookkeeping that keeps updates idempotent.
 */

export const GIT_NOTIFY_QUEUE = 'git-notify'

export interface GitLink {
  installationId: string
  repoRef: string
}

export namespace getProjectGitAttention {
  /** What the dashboard shows when CirCI can't use a project's git connection. */
  export interface Attention {
    reason: getProjectGitAttention.Kind
    since: Date
  }

  /** Why a connection needs a person's attention (see `markInstallationNeedsAttention`). */
  export type Kind = (typeof CONNECTION_ATTENTION)[number]
}

/** Points a project at a repository through a GitHub App installation. */
export async function linkProjectToGithub(
  db: Database,
  projectId: string,
  link: GitLink,
): Promise<void> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId))
  if (!project) throw new NotFoundError('Project not found')
  const [connection] = await db
    .insert(providerConnections)
    .values({ orgId: project.orgId, kind: 'github', externalId: link.installationId })
    .onConflictDoUpdate({
      target: [providerConnections.orgId, providerConnections.kind, providerConnections.externalId],
      // Linking again is how someone says "I reinstalled the App": try afresh.
      set: { externalId: link.installationId, needsAttention: null, needsAttentionAt: null },
    })
    .returning()
  if (!connection) throw new Error('upsert returned no row')
  await db
    .update(projects)
    .set({ providerConnectionId: connection.id, repoRef: link.repoRef })
    .where(eq(projects.id, projectId))
}

/**
 * Records that an organisation uses a GitHub App installation, without linking a project yet
 * (the Integrations page's "Add GitHub"). Connecting again clears a needs-attention mark.
 */
export async function connectGithub(
  db: Database,
  orgId: string,
  installationId: string,
): Promise<{ id: string }> {
  const [connection] = await db
    .insert(providerConnections)
    .values({ orgId, kind: 'github', externalId: installationId })
    .onConflictDoUpdate({
      target: [providerConnections.orgId, providerConnections.kind, providerConnections.externalId],
      set: { needsAttention: null, needsAttentionAt: null },
    })
    .returning({ id: providerConnections.id })
  if (!connection) throw new Error('upsert returned no row')
  return connection
}

/** Whether another organisation already has a connection to this host account or installation. */
export async function isInstallationClaimedElsewhere(
  db: Database,
  kind: string,
  externalId: string,
  orgId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: providerConnections.id })
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.kind, kind),
        eq(providerConnections.externalId, externalId),
        ne(providerConnections.orgId, orgId),
      ),
    )
    .limit(1)
  return row !== undefined
}

export namespace listGitConnections {
  export interface Row {
    id: string
    kind: string
    externalId: string
    needsAttention: string | null
    createdAt: Date
    /** Projects of the organisation that report through it. */
    projectCount: number
  }
}

/** The organisation's git connections, oldest first, with how many projects use each. */
export async function listGitConnections(
  db: Database,
  orgId: string,
): Promise<listGitConnections.Row[]> {
  const rows = await db
    .select({
      id: providerConnections.id,
      kind: providerConnections.kind,
      externalId: providerConnections.externalId,
      needsAttention: providerConnections.needsAttention,
      createdAt: providerConnections.createdAt,
      projectCount: sql<number>`count(${projects.id})::int`,
    })
    .from(providerConnections)
    .leftJoin(projects, eq(projects.providerConnectionId, providerConnections.id))
    .where(eq(providerConnections.orgId, orgId))
    .groupBy(providerConnections.id)
    .orderBy(providerConnections.createdAt, providerConnections.id)
  return rows
}

/** A git connection of the organisation (undefined for another organisation's). */
export async function getGitConnection(
  db: Database,
  orgId: string,
  connectionId: string,
): Promise<typeof providerConnections.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.orgId, orgId), eq(providerConnections.id, connectionId)))
  return row
}

/**
 * Disconnects a git host: every project reporting through it stops (as `unlinkProject` does for
 * one), and the connection goes. False when the organisation has no such connection.
 */
export async function removeGitConnection(
  db: Database,
  orgId: string,
  connectionId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const connection = await getGitConnection(tx, orgId, connectionId)
    if (!connection) return false
    await tx
      .update(projects)
      .set({ providerConnectionId: null, repoRef: null })
      .where(eq(projects.providerConnectionId, connection.id))
    await tx.delete(providerConnections).where(eq(providerConnections.id, connection.id))
    return true
  })
}

/** Each of the organisation's projects with the repository it reports to, if any. */
export async function listProjectRepoLinks(
  db: Database,
  orgId: string,
): Promise<
  { slug: string; name: string; repoRef: string | null; connectionExternalId: string | null }[]
> {
  return db
    .select({
      slug: projects.slug,
      name: projects.name,
      repoRef: projects.repoRef,
      connectionExternalId: providerConnections.externalId,
    })
    .from(projects)
    .leftJoin(providerConnections, eq(providerConnections.id, projects.providerConnectionId))
    .where(eq(projects.orgId, orgId))
    .orderBy(projects.name, projects.slug)
}

export async function unlinkProject(db: Database, projectId: string): Promise<void> {
  await db
    .update(projects)
    .set({ providerConnectionId: null, repoRef: null })
    .where(eq(projects.id, projectId))
}

/**
 * Records that the host no longer accepts this connection (a GitHub installation uninstalled or
 * suspended, a revoked token), on every organization's connection of that `kind` to it. Keeps the time of the first failure.
 */
export async function markInstallationNeedsAttention(
  db: Database,
  kind: string,
  installationId: string,
  reason: getProjectGitAttention.Kind,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(providerConnections)
    .set({ needsAttention: reason, needsAttentionAt: now })
    .where(
      and(
        eq(providerConnections.kind, kind),
        eq(providerConnections.externalId, installationId),
        or(
          isNull(providerConnections.needsAttention),
          ne(providerConnections.needsAttention, reason),
        ),
      ),
    )
}

/** Clears the state above, after a call to GitHub succeeded. */
export async function clearInstallationNeedsAttention(
  db: Database,
  kind: string,
  installationId: string,
): Promise<void> {
  await db
    .update(providerConnections)
    .set({ needsAttention: null, needsAttentionAt: null })
    .where(
      and(
        eq(providerConnections.kind, kind),
        eq(providerConnections.externalId, installationId),
        isNotNull(providerConnections.needsAttention),
      ),
    )
}

/** Whether CirCI can't use the project's git connection; undefined when it works or there is none. */
export async function getProjectGitAttention(
  db: Database,
  projectId: string,
): Promise<getProjectGitAttention.Attention | undefined> {
  const [row] = await db
    .select({
      reason: providerConnections.needsAttention,
      since: providerConnections.needsAttentionAt,
    })
    .from(projects)
    .innerJoin(providerConnections, eq(providerConnections.id, projects.providerConnectionId))
    .where(eq(projects.id, projectId))
  const reason = CONNECTION_ATTENTION.find((r) => r === row?.reason)
  return reason && row?.since ? { reason, since: row.since } : undefined
}

export async function getProjectLink(
  db: Database,
  projectId: string,
): Promise<GitLink | undefined> {
  const [row] = await db
    .select({ installationId: providerConnections.externalId, repoRef: projects.repoRef })
    .from(projects)
    .innerJoin(providerConnections, eq(providerConnections.id, projects.providerConnectionId))
    .where(eq(projects.id, projectId))
  return row?.repoRef ? { installationId: row.installationId, repoRef: row.repoRef } : undefined
}

export namespace getGitTarget {
  /** Everything the notify job needs to report a build. */
  export interface Target extends GitLink {
    /** The connection's `kind`: which provider reports this build. */
    kind: string
    /** Sealed credentials of a token-based host (null for GitHub). */
    encryptedCredentials: string | null
    build: Build
    orgSlug: string
    projectSlug: string
    projectName: string
    blockMergeOnChanges: boolean
    commentsEnabled: boolean
    /** The connection is marked as unusable; a successful notify clears it. */
    connectionNeedsAttention: boolean
  }
}

export async function getGitTarget(
  db: Database,
  buildId: string,
): Promise<getGitTarget.Target | undefined> {
  const [row] = await db
    .select({
      build: builds,
      orgSlug: organization.slug,
      projectSlug: projects.slug,
      projectName: projects.name,
      block: projects.blockMergeOnChanges,
      repoRef: projects.repoRef,
      installationId: providerConnections.externalId,
      kind: providerConnections.kind,
      credentials: providerConnections.encryptedCredentials,
      attention: providerConnections.needsAttention,
    })
    .from(builds)
    .innerJoin(projects, eq(projects.id, builds.projectId))
    .innerJoin(organization, eq(organization.id, projects.orgId))
    .innerJoin(providerConnections, eq(providerConnections.id, projects.providerConnectionId))
    .where(eq(builds.id, buildId))
  if (!row?.repoRef) return undefined
  return {
    build: row.build,
    orgSlug: row.orgSlug,
    projectSlug: row.projectSlug,
    projectName: row.projectName,
    blockMergeOnChanges: row.block,
    commentsEnabled: true,
    connectionNeedsAttention: row.attention !== null,
    repoRef: row.repoRef,
    installationId: row.installationId,
    kind: row.kind,
    encryptedCredentials: row.credentials,
  }
}

/**
 * Queues a "tell the git host" job when the build's project is linked to a repository. Call it
 * inside the transaction that changed the build. One job per distinct state, so a change that
 * lands while an older job runs still gets reported.
 */
export async function queueGitNotify(
  db: Database,
  build: Pick<Build, 'id' | 'projectId' | 'status' | 'conclusion' | 'reviewStatus'>,
): Promise<void> {
  const [linked] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, build.projectId), sql`${projects.providerConnectionId} is not null`))
  if (!linked) return
  await enqueueJob(db, {
    queue: GIT_NOTIFY_QUEUE,
    payload: { buildId: build.id },
    dedupeKey: `git-notify:${build.id}:${build.status}:${build.conclusion ?? '-'}:${build.reviewStatus}`,
  })
}

export async function getCheckRunId(db: Database, buildId: string): Promise<string | undefined> {
  const [row] = await db.select().from(buildChecks).where(eq(buildChecks.buildId, buildId))
  return row?.checkRunId
}

export async function setCheckRunId(
  db: Database,
  buildId: string,
  checkRunId: string,
): Promise<void> {
  await db
    .insert(buildChecks)
    .values({ buildId, checkRunId })
    .onConflictDoUpdate({ target: buildChecks.buildId, set: { checkRunId } })
}

export async function getPrCommentId(
  db: Database,
  projectId: string,
  prNumber: number,
): Promise<string | undefined> {
  const [row] = await db
    .select()
    .from(prComments)
    .where(and(eq(prComments.projectId, projectId), eq(prComments.prNumber, prNumber)))
  return row?.commentId
}

export async function setPrCommentId(
  db: Database,
  projectId: string,
  prNumber: number,
  commentId: string,
): Promise<void> {
  await db
    .insert(prComments)
    .values({ projectId, prNumber, commentId })
    .onConflictDoUpdate({ target: [prComments.projectId, prComments.prNumber], set: { commentId } })
}

/** Records a webhook delivery; false when it was already handled. */
export async function claimDelivery(db: Database, deliveryId: string): Promise<boolean> {
  const rows = await db
    .insert(providerDeliveries)
    .values({ deliveryId })
    .onConflictDoNothing()
    .returning({ id: providerDeliveries.deliveryId })
  return rows.length > 0
}

/** The build a check run belongs to, with its project (for who may review it). */
export async function findBuildByCheckRun(
  db: Database,
  checkRunId: string,
): Promise<Build | undefined> {
  const [row] = await db
    .select({ build: builds })
    .from(buildChecks)
    .innerJoin(builds, eq(builds.id, buildChecks.buildId))
    .where(eq(buildChecks.checkRunId, checkRunId))
  return row?.build
}

/** Projects linked to a repository (compared case-insensitively, as GitHub does). */
export async function findProjectsByRepo(
  db: Database,
  installationId: string,
  repoRef: string,
): Promise<{ id: string; orgId: string }[]> {
  return db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .innerJoin(providerConnections, eq(providerConnections.id, projects.providerConnectionId))
    .where(
      and(
        eq(providerConnections.externalId, installationId),
        sql`lower(${projects.repoRef}) = ${repoRef.toLowerCase()}`,
      ),
    )
}

/** The builds of a pull request's newest commit (one per build name), newest first. */
export async function latestBuildsForPr(
  db: Database,
  projectId: string,
  prNumber: number,
): Promise<Build[]> {
  const [newest] = await db
    .select()
    .from(builds)
    .where(and(eq(builds.projectId, projectId), eq(builds.prNumber, prNumber)))
    .orderBy(desc(builds.number))
    .limit(1)
  if (!newest) return []
  return db
    .select()
    .from(builds)
    .where(
      and(
        eq(builds.projectId, projectId),
        eq(builds.prNumber, prNumber),
        eq(builds.commitSha, newest.commitSha),
      ),
    )
    .orderBy(desc(builds.number))
}

/** All of a pull request's builds' newest-per-name rows, for the summary comment. */
export async function buildsForPrSummary(
  db: Database,
  projectId: string,
  prNumber: number,
): Promise<Build[]> {
  return latestBuildsForPr(db, projectId, prNumber)
}

/**
 * The CirCI user a GitHub user is, when they linked their GitHub login (matched by GitHub's
 * numeric user id, never by email) and belong to the project's organization.
 */
export async function findMemberByGithubId(
  db: Database,
  githubUserId: string,
  projectId: string,
): Promise<string | undefined> {
  const rows = await db
    .select({ userId: account.userId, role: member.role })
    .from(account)
    .innerJoin(projects, eq(projects.id, projectId))
    .innerJoin(
      member,
      and(eq(member.userId, account.userId), eq(member.organizationId, projects.orgId)),
    )
    .where(and(eq(account.providerId, 'github'), eq(account.accountId, githubUserId)))
  return rows[0]?.userId
}
