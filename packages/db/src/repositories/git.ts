import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'

import type { CONNECTION_ATTENTION } from '#schema/enums.ts'
import {
  buildChecks,
  builds,
  integrationProjects,
  integrations,
  organization,
  prComments,
  projects,
  providerDeliveries,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import type { Build } from '#src/types.ts'

import { enqueueJob } from './jobs.ts'

/**
 * Git host integration (PLAN §7.4): which projects report to which repository, the jobs that
 * push build state to it, and the bookkeeping that keeps updates idempotent. A git host is an
 * integration (`integrations`) and a project's repository is its `integration_projects` row for
 * it (`external_ref` is the repository). Which kinds are git hosts is the registry's knowledge
 * (`integrationRegistry.gitKinds()` in `@circi/integrations`); callers pass `kinds`.
 */

export const GIT_NOTIFY_QUEUE = 'git-notify'

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

/** A project's mapping on one of its git connections: the connection and the repository. */
async function gitMapping(db: Database, projectId: string, kinds: GitKinds) {
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

/** Stops a project reporting to any git host (the repository mapping goes; the connection stays). */
export async function unlinkProject(
  db: Database,
  projectId: string,
  kinds: GitKinds,
): Promise<void> {
  if (kinds.length === 0) return
  await db.delete(integrationProjects).where(
    and(
      eq(integrationProjects.projectId, projectId),
      inArray(
        integrationProjects.integrationId,
        db
          .select({ id: integrations.id })
          .from(integrations)
          .where(inArray(integrations.kind, [...kinds])),
      ),
    ),
  )
}

/**
 * Records that the host no longer accepts this connection (a GitHub installation uninstalled or
 * suspended, a revoked token), on every organization's connection of that `kind` to it. Keeps the
 * time of the first failure.
 */
export async function markInstallationNeedsAttention(
  db: Database,
  kind: string,
  externalId: string,
  reason: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(integrations)
    .set({
      needsAttention: true,
      needsAttentionReason: reason,
      needsAttentionAt: sql`coalesce(${integrations.needsAttentionAt}, ${now.toISOString()}::timestamptz)`,
    })
    .where(and(eq(integrations.kind, kind), eq(integrations.externalId, externalId)))
}

/** Clears the state above, after a call to the host succeeded. */
export async function clearInstallationNeedsAttention(
  db: Database,
  kind: string,
  externalId: string,
): Promise<void> {
  await db
    .update(integrations)
    .set({ needsAttention: false, needsAttentionReason: null, needsAttentionAt: null })
    .where(
      and(
        eq(integrations.kind, kind),
        eq(integrations.externalId, externalId),
        eq(integrations.needsAttention, true),
      ),
    )
}

/** Whether CirCI can't use the project's git connection; undefined when it works or there is none. */
export async function getProjectGitAttention(
  db: Database,
  projectId: string,
  kinds: GitKinds,
): Promise<getProjectGitAttention.Attention | undefined> {
  const mapping = await gitMapping(db, projectId, kinds)
  const since = mapping?.integration.needsAttentionAt
  if (!mapping?.integration.needsAttention || !since) return undefined
  return { reason: 'installation_revoked', since }
}

export async function getProjectLink(
  db: Database,
  projectId: string,
  kinds: GitKinds,
): Promise<GitLink | undefined> {
  const mapping = await gitMapping(db, projectId, kinds)
  return mapping
    ? { installationId: mapping.integration.externalId, repoRef: mapping.repoRef }
    : undefined
}

export namespace getGitTarget {
  /** Everything the notify job needs to report a build. */
  export interface Target extends GitLink {
    /** The connection (integration) the project reports through. */
    integrationId: string
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
  kinds: GitKinds,
): Promise<getGitTarget.Target | undefined> {
  if (kinds.length === 0) return undefined
  const [row] = await db
    .select({
      build: builds,
      orgSlug: organization.slug,
      projectSlug: projects.slug,
      projectName: projects.name,
      block: projects.blockMergeOnChanges,
      repoRef: integrationProjects.externalRef,
      integrationId: integrations.id,
      installationId: integrations.externalId,
      kind: integrations.kind,
      credentials: integrations.encryptedCredentials,
      attention: integrations.needsAttention,
    })
    .from(builds)
    .innerJoin(projects, eq(projects.id, builds.projectId))
    .innerJoin(organization, eq(organization.id, projects.orgId))
    .innerJoin(integrationProjects, eq(integrationProjects.projectId, projects.id))
    .innerJoin(integrations, eq(integrations.id, integrationProjects.integrationId))
    .where(and(eq(builds.id, buildId), inArray(integrations.kind, [...kinds])))
    .orderBy(integrationProjects.createdAt)
    .limit(1)
  if (!row) return undefined
  return {
    build: row.build,
    orgSlug: row.orgSlug,
    projectSlug: row.projectSlug,
    projectName: row.projectName,
    blockMergeOnChanges: row.block,
    commentsEnabled: true,
    connectionNeedsAttention: row.attention,
    repoRef: row.repoRef,
    integrationId: row.integrationId,
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
  kinds: GitKinds,
): Promise<void> {
  if (!(await gitMapping(db, build.projectId, kinds))) return
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

export namespace findGitProjects {
  export interface Row {
    id: string
    orgId: string
    integrationId: string
    /** The connection's external id (the GitHub installation, the Bitbucket workspace…). */
    externalId: string
    /** The connection's sealed credentials, to answer on the pull request. */
    encryptedCredentials: string | null
  }
}

/**
 * Projects linked to a repository on a host's connection, for webhooks that name the repository
 * and where it lives but not our connection: `connection` is the external id, or the start of it
 * (GitLab: `host#`). Compared case-insensitively, as the hosts do.
 */
export async function findGitProjects(
  db: Database,
  kind: string,
  connection: { externalId: string } | { externalIdPrefix: string },
  repoRef: string,
): Promise<findGitProjects.Row[]> {
  const matches =
    'externalId' in connection
      ? sql`lower(${integrations.externalId}) = ${connection.externalId.toLowerCase()}`
      : sql`starts_with(lower(${integrations.externalId}), ${connection.externalIdPrefix.toLowerCase()})`
  return db
    .select({
      id: projects.id,
      orgId: projects.orgId,
      integrationId: integrations.id,
      externalId: integrations.externalId,
      encryptedCredentials: integrations.encryptedCredentials,
    })
    .from(integrationProjects)
    .innerJoin(integrations, eq(integrations.id, integrationProjects.integrationId))
    .innerJoin(projects, eq(projects.id, integrationProjects.projectId))
    .where(
      and(
        eq(integrations.kind, kind),
        matches,
        sql`lower(${integrationProjects.externalRef}) = ${repoRef.toLowerCase()}`,
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
