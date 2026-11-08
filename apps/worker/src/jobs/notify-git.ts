import { openSecret } from '@circi/core'
import {
  buildsForPrSummary,
  type Database,
  getBuildCounts,
  getCheckRunId,
  getGitTarget,
  getPrCommentId,
  type Job,
  clearInstallationNeedsAttention,
  markInstallationNeedsAttention,
  setCheckRunId,
  setPrCommentId,
  withAdvisoryLock,
} from '@circi/db'
import {
  checkReport,
  type GitProvider,
  isConnectionRevoked,
  prCommentBody,
  type ProviderRegistry,
  providerRegistry,
  type ReportedBuild,
} from '@circi/providers'
import { gateInputs } from '@circi/services'

/** The `git-notify` job: show a build's state on its commit and pull request (PLAN §7.4). */

/** What the job needs of a git host adapter. */
export type NotifyProvider = Pick<GitProvider, 'upsertCheckRun' | 'upsertComment'>

export interface NotifyDeps {
  db: Database
  /** The adapters by connection kind. Overrides `github` when both are given. */
  providers?: ProviderRegistry<NotifyProvider> | undefined
  /** Shorthand for a registry holding only the GitHub App, when this instance has one. */
  github?: NotifyProvider | undefined
  /** Dashboard origin, for links back to the build. */
  publicOrigin: string
  /** The instance secret, to open a connection's sealed credentials (token hosts). */
  authSecret?: string | undefined
}

export type NotifyResult = { status: 'skipped'; reason: string } | { status: 'notified' }

/**
 * Reads the build's *current* state (not the state when the job was queued) and writes it as a
 * check run, plus the pull request's summary comment. Throws on GitHub errors, so the queue
 * retries; running it twice just writes the same thing again.
 */
export async function notifyGit(deps: NotifyDeps, job: Job): Promise<NotifyResult> {
  const buildId = typeof job.payload.buildId === 'string' ? job.payload.buildId : undefined
  if (!buildId) return { status: 'skipped', reason: 'malformed job' }
  const providers = deps.providers ?? providerRegistry({ github: deps.github })
  if (providers.kinds().length === 0)
    return { status: 'skipped', reason: 'no GitHub App configured' }
  const first = await getGitTarget(deps.db, buildId)
  if (!first) return { status: 'skipped', reason: 'project is not linked to a repository' }
  const provider = providers.get(first.kind)
  if (!provider) return { status: 'skipped', reason: `no ${first.kind} provider configured` }

  // Jobs for one project run one at a time (lanes and worker processes both): two at once would
  // each create the build's check run and the pull request's comment, because neither has seen
  // the other's id yet. State is read inside the lock, so a job that waited writes the latest.
  try {
    return await withAdvisoryLock(deps.db, `git-notify:${first.build.projectId}`, async (db) => {
      const target = await getGitTarget(db, buildId)
      if (!target) return { status: 'skipped', reason: 'project is not linked to a repository' }
      let credentials: string | undefined
      if (target.encryptedCredentials !== null) {
        credentials = deps.authSecret
          ? openSecret(deps.authSecret, target.encryptedCredentials)
          : undefined
        if (credentials === undefined) {
          return { status: 'skipped', reason: `${target.kind} credentials cannot be opened` }
        }
      }
      const result = await notifyLocked({ ...deps, db, provider, credentials }, target)
      // GitHub accepted the calls again (the App was reinstalled): drop the warning.
      if (target.connectionNeedsAttention) {
        await clearInstallationNeedsAttention(db, target.kind, target.installationId)
      }
      return result
    })
  } catch (err) {
    if (!isConnectionRevoked(err)) throw err
    // Uninstalled or suspended: retrying cannot help. Record it for the dashboard and finish the
    // job; the next build's job tries again, and clears the state once GitHub answers.
    await markInstallationNeedsAttention(
      deps.db,
      first.kind,
      first.installationId,
      'installation_revoked',
    )
    return {
      status: 'skipped',
      reason: `${first.kind} connection ${first.installationId} was removed or suspended`,
    }
  }
}

async function notifyLocked(
  deps: NotifyDeps & { provider: NotifyProvider; credentials: string | undefined },
  target: NonNullable<Awaited<ReturnType<typeof getGitTarget>>>,
): Promise<NotifyResult> {
  const reported = async (b: typeof target.build): Promise<ReportedBuild> => {
    const counts = await getBuildCounts(deps.db, b.id)
    const gate = await gateInputs(deps.db, b)
    return {
      number: b.number,
      name: b.name,
      status: b.status,
      conclusion: b.conclusion,
      reviewStatus: b.reviewStatus,
      prNumber: b.prNumber,
      errorMessage: b.errorMessage,
      counts,
      flakyOnly: gate.flakyOnly,
      url: `${deps.publicOrigin}/${target.orgSlug}/${target.projectSlug}/builds/${b.number}`,
    }
  }

  const mine = await reported(target.build)
  const { flakyBlocksMerge } = await gateInputs(deps.db, target.build)
  await setCheck(deps, target, mine, flakyBlocksMerge)

  if (target.build.prNumber !== null && target.commentsEnabled) {
    const builds = await buildsForPrSummary(deps.db, target.build.projectId, target.build.prNumber)
    const body = prCommentBody(await Promise.all(builds.map(reported)))
    const existing = await getPrCommentId(deps.db, target.build.projectId, target.build.prNumber)
    const commentId = await deps.provider.upsertComment(
      target.installationId,
      target.repoRef,
      target.build.prNumber,
      body,
      existing,
      deps.credentials,
    )
    if (commentId !== existing) {
      await setPrCommentId(deps.db, target.build.projectId, target.build.prNumber, commentId)
    }
  }
  return { status: 'notified' }
}

async function setCheck(
  deps: NotifyDeps & { provider: NotifyProvider; credentials: string | undefined },
  target: NonNullable<Awaited<ReturnType<typeof getGitTarget>>>,
  mine: ReportedBuild,
  flakyBlocksMerge: boolean,
): Promise<void> {
  const existingId = await getCheckRunId(deps.db, target.build.id)
  const id = await deps.provider.upsertCheckRun(
    target.installationId,
    target.repoRef,
    {
      sha: target.build.commitSha,
      report: checkReport(mine, {
        blockMergeOnChanges: target.blockMergeOnChanges,
        flakyBlocksMerge,
      }),
      detailsUrl: mine.url,
      ...(existingId ? { existingId } : {}),
    },
    deps.credentials,
  )
  if (id && id !== existingId) await setCheckRunId(deps.db, target.build.id, id)
}
