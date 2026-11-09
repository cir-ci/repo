import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'

import { getGitMapping, type GitKinds, type GitLink } from '#queries/git-links.ts'
import {
  buildChecks,
  builds,
  integrationTeams,
  integrations,
  workspace,
  prComments,
  teams,
  providerDeliveries,
} from '#schema/index.ts'
import { workspaceIsLive } from '#shared/session-method.ts'
import type { Database } from '#src/client.ts'
import type { Build } from '#src/types.ts'

import { enqueueJob } from './jobs.ts'

/**
 * Git host integration (PLAN §7.4): which teams report to which repository, the jobs that
 * push build state to it, and the bookkeeping that keeps updates idempotent. A git host is an
 * integration (`integrations`) and a team's repository is its `integration_teams` row for
 * it (`external_ref` is the repository). Which kinds are git hosts is the registry's knowledge
 * (`integrationRegistry.gitKinds()` in `@circi/integrations`); callers pass `kinds`.
 */

export const GIT_NOTIFY_QUEUE = 'git-notify'

/** Stops a team reporting to any git host (the repository mapping goes; the connection stays). */
export async function unlinkTeam(db: Database, teamId: string, kinds: GitKinds): Promise<void> {
  if (kinds.length === 0) return
  await db.delete(integrationTeams).where(
    and(
      eq(integrationTeams.teamId, teamId),
      inArray(
        integrationTeams.integrationId,
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
 * suspended, a revoked token), on every workspace's connection of that `kind` to it. Keeps the
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

export namespace getGitTarget {
  /** Everything the notify job needs to report a build. */
  export interface Target extends GitLink {
    /** The connection (integration) the team reports through. */
    integrationId: string
    /** The connection's `kind`: which provider reports this build. */
    kind: string
    /** Sealed credentials of a token-based host (null for GitHub). */
    encryptedCredentials: string | null
    build: Build
    workspaceSlug: string
    teamSlug: string
    teamName: string
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
      workspaceSlug: workspace.slug,
      teamSlug: teams.slug,
      teamName: teams.name,
      block: teams.blockMergeOnChanges,
      repoRef: integrationTeams.externalRef,
      integrationId: integrations.id,
      installationId: integrations.externalId,
      kind: integrations.kind,
      credentials: integrations.encryptedCredentials,
      attention: integrations.needsAttention,
    })
    .from(builds)
    .innerJoin(teams, eq(teams.id, builds.teamId))
    .innerJoin(workspace, eq(workspace.id, teams.workspaceId))
    .innerJoin(integrationTeams, eq(integrationTeams.teamId, teams.id))
    .innerJoin(integrations, eq(integrations.id, integrationTeams.integrationId))
    .where(and(eq(builds.id, buildId), inArray(integrations.kind, [...kinds])))
    .orderBy(integrationTeams.createdAt)
    .limit(1)
  if (!row) return undefined
  return {
    build: row.build,
    workspaceSlug: row.workspaceSlug,
    teamSlug: row.teamSlug,
    teamName: row.teamName,
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
 * Queues a "tell the git host" job when the build's team is linked to a repository. Call it
 * inside the transaction that changed the build. One job per distinct state, so a change that
 * lands while an older job runs still gets reported.
 */
export async function queueGitNotify(
  db: Database,
  build: Pick<Build, 'id' | 'teamId' | 'status' | 'conclusion' | 'reviewStatus'>,
  kinds: GitKinds,
): Promise<void> {
  if (!(await getGitMapping(db, build.teamId, kinds))) return
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
  teamId: string,
  prNumber: number,
): Promise<string | undefined> {
  const [row] = await db
    .select()
    .from(prComments)
    .where(and(eq(prComments.teamId, teamId), eq(prComments.prNumber, prNumber)))
  return row?.commentId
}

export async function setPrCommentId(
  db: Database,
  teamId: string,
  prNumber: number,
  commentId: string,
): Promise<void> {
  await db
    .insert(prComments)
    .values({ teamId, prNumber, commentId })
    .onConflictDoUpdate({ target: [prComments.teamId, prComments.prNumber], set: { commentId } })
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

/** The build a check run belongs to, with its team (for who may review it). */
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
  teamId: string,
  prNumber: number,
): Promise<Build[]> {
  const [newest] = await db
    .select()
    .from(builds)
    .where(and(eq(builds.teamId, teamId), eq(builds.prNumber, prNumber)))
    .orderBy(desc(builds.number))
    .limit(1)
  if (!newest) return []
  return db
    .select()
    .from(builds)
    .where(
      and(
        eq(builds.teamId, teamId),
        eq(builds.prNumber, prNumber),
        eq(builds.commitSha, newest.commitSha),
      ),
    )
    .orderBy(desc(builds.number))
}

/** All of a pull request's builds' newest-per-name rows, for the summary comment. */
export async function buildsForPrSummary(
  db: Database,
  teamId: string,
  prNumber: number,
): Promise<Build[]> {
  return latestBuildsForPr(db, teamId, prNumber)
}

export namespace findGitTeams {
  export interface Row {
    id: string
    workspaceId: string
    integrationId: string
    /** The connection's external id (the GitHub installation, the Bitbucket workspace…). */
    externalId: string
    /** The connection's sealed credentials, to answer on the pull request. */
    encryptedCredentials: string | null
  }
}

/**
 * Teams linked to a repository on a host's connection, for webhooks that name the repository
 * and where it lives but not our connection: `connection` is the external id, or the start of it
 * (GitLab: `host#`). Compared case-insensitively, as the hosts do.
 */
export async function findGitTeams(
  db: Database,
  kind: string,
  connection: { externalId: string } | { externalIdPrefix: string },
  repoRef: string,
): Promise<findGitTeams.Row[]> {
  const matches =
    'externalId' in connection
      ? sql`lower(${integrations.externalId}) = ${connection.externalId.toLowerCase()}`
      : sql`starts_with(lower(${integrations.externalId}), ${connection.externalIdPrefix.toLowerCase()})`
  return db
    .select({
      id: teams.id,
      workspaceId: teams.workspaceId,
      integrationId: integrations.id,
      externalId: integrations.externalId,
      encryptedCredentials: integrations.encryptedCredentials,
    })
    .from(integrationTeams)
    .innerJoin(integrations, eq(integrations.id, integrationTeams.integrationId))
    .innerJoin(teams, eq(teams.id, integrationTeams.teamId))
    .where(
      and(
        eq(integrations.kind, kind),
        matches,
        sql`lower(${integrationTeams.externalRef}) = ${repoRef.toLowerCase()}`,
        // A deleted workspace's teams hear nothing from the host.
        workspaceIsLive(teams.workspaceId),
      ),
    )
}

/**
 * Gives builds a pull request number the host now knows: builds of the team that don't have
 * one yet and were made for this commit or for the pull request's source branch. Returns how many
 * builds changed.
 */
export async function linkBuildsToPullRequest(
  db: Database,
  input: { teamId: string; prNumber: number; commitSha?: string; branch?: string },
): Promise<number> {
  const matches = [
    ...(input.commitSha ? [eq(builds.commitSha, input.commitSha)] : []),
    ...(input.branch ? [eq(builds.branch, input.branch)] : []),
  ]
  if (matches.length === 0) return 0
  const rows = await db
    .update(builds)
    .set({ prNumber: input.prNumber })
    .where(and(eq(builds.teamId, input.teamId), isNull(builds.prNumber), or(...matches)))
    .returning({ id: builds.id })
  return rows.length
}
