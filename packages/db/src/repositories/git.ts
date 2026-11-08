import { and, desc, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { NotFoundError } from '../errors.ts'
import { CONNECTION_ATTENTION } from '../schema/enums.ts'
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
} from '../schema/index.ts'
import type { Build } from '../types.ts'
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

/** Why a connection needs a person's attention (see `markInstallationNeedsAttention`). */
export type ConnectionAttention = (typeof CONNECTION_ATTENTION)[number]

/** What the dashboard shows when CirCI can't use a project's git connection. */
export interface GitAttention {
  reason: ConnectionAttention
  since: Date
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
    .values({ orgId: project.orgId, kind: 'github', installationId: link.installationId })
    .onConflictDoUpdate({
      target: [
        providerConnections.orgId,
        providerConnections.kind,
        providerConnections.installationId,
      ],
      // Linking again is how someone says "I reinstalled the App": try afresh.
      set: { installationId: link.installationId, needsAttention: null, needsAttentionAt: null },
    })
    .returning()
  if (!connection) throw new Error('upsert returned no row')
  await db
    .update(projects)
    .set({ providerConnectionId: connection.id, repoRef: link.repoRef })
    .where(eq(projects.id, projectId))
}

export async function unlinkProject(db: Database, projectId: string): Promise<void> {
  await db
    .update(projects)
    .set({ providerConnectionId: null, repoRef: null })
    .where(eq(projects.id, projectId))
}

/**
 * Records that GitHub no longer accepts this installation (uninstalled or suspended), on every
 * organization's connection to it. Keeps the time of the first failure.
 */
export async function markInstallationNeedsAttention(
  db: Database,
  installationId: string,
  reason: ConnectionAttention,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(providerConnections)
    .set({ needsAttention: reason, needsAttentionAt: now })
    .where(
      and(
        eq(providerConnections.kind, 'github'),
        eq(providerConnections.installationId, installationId),
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
  installationId: string,
): Promise<void> {
  await db
    .update(providerConnections)
    .set({ needsAttention: null, needsAttentionAt: null })
    .where(
      and(
        eq(providerConnections.kind, 'github'),
        eq(providerConnections.installationId, installationId),
        isNotNull(providerConnections.needsAttention),
      ),
    )
}

/** Whether CirCI can't use the project's git connection; undefined when it works or there is none. */
export async function getProjectGitAttention(
  db: Database,
  projectId: string,
): Promise<GitAttention | undefined> {
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
    .select({ installationId: providerConnections.installationId, repoRef: projects.repoRef })
    .from(projects)
    .innerJoin(providerConnections, eq(providerConnections.id, projects.providerConnectionId))
    .where(eq(projects.id, projectId))
  return row?.repoRef ? { installationId: row.installationId, repoRef: row.repoRef } : undefined
}

/** Everything the notify job needs to report a build. */
export interface GitTarget extends GitLink {
  build: Build
  orgSlug: string
  projectSlug: string
  projectName: string
  blockMergeOnChanges: boolean
  commentsEnabled: boolean
  /** The connection is marked as unusable; a successful notify clears it. */
  connectionNeedsAttention: boolean
}

export async function getGitTarget(db: Database, buildId: string): Promise<GitTarget | undefined> {
  const [row] = await db
    .select({
      build: builds,
      orgSlug: organization.slug,
      projectSlug: projects.slug,
      projectName: projects.name,
      block: projects.blockMergeOnChanges,
      repoRef: projects.repoRef,
      installationId: providerConnections.installationId,
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
        eq(providerConnections.installationId, installationId),
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
