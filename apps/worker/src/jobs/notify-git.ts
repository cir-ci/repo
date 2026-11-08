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
  type GithubApp,
  GithubInstallationRevokedError,
  prCommentBody,
  type ReportedBuild,
} from '@circi/providers'
import { gateInputs } from '@circi/services'

/** The `git-notify` job: show a build's state on its commit and pull request (PLAN §7.4). */

export interface NotifyDeps {
  db: Database
  /** The GitHub App, when this instance has one. */
  github: Pick<GithubApp, 'upsertCheckRun' | 'upsertComment'> | undefined
  /** Dashboard origin, for links back to the build. */
  publicOrigin: string
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
  const github = deps.github
  if (!github) return { status: 'skipped', reason: 'no GitHub App configured' }
  const first = await getGitTarget(deps.db, buildId)
  if (!first) return { status: 'skipped', reason: 'project is not linked to a repository' }

  // Jobs for one project run one at a time (lanes and worker processes both): two at once would
  // each create the build's check run and the pull request's comment, because neither has seen
  // the other's id yet. State is read inside the lock, so a job that waited writes the latest.
  try {
    return await withAdvisoryLock(deps.db, `git-notify:${first.build.projectId}`, async (db) => {
      const target = await getGitTarget(db, buildId)
      if (!target) return { status: 'skipped', reason: 'project is not linked to a repository' }
      const result = await notifyLocked({ ...deps, db, github }, target)
      // GitHub accepted the calls again (the App was reinstalled): drop the warning.
      if (target.connectionNeedsAttention) {
        await clearInstallationNeedsAttention(db, target.installationId)
      }
      return result
    })
  } catch (err) {
    if (!(err instanceof GithubInstallationRevokedError)) throw err
    // Uninstalled or suspended: retrying cannot help. Record it for the dashboard and finish the
    // job; the next build's job tries again, and clears the state once GitHub answers.
    await markInstallationNeedsAttention(deps.db, first.installationId, 'installation_revoked')
    return {
      status: 'skipped',
      reason: `GitHub installation ${first.installationId} was removed or suspended`,
    }
  }
}

async function notifyLocked(
  deps: NotifyDeps & { github: NonNullable<NotifyDeps['github']> },
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
    const commentId = await deps.github.upsertComment(
      target.installationId,
      target.repoRef,
      target.build.prNumber,
      body,
      existing,
    )
    if (commentId !== existing) {
      await setPrCommentId(deps.db, target.build.projectId, target.build.prNumber, commentId)
    }
  }
  return { status: 'notified' }
}

async function setCheck(
  deps: NotifyDeps,
  target: NonNullable<Awaited<ReturnType<typeof getGitTarget>>>,
  mine: ReportedBuild,
  flakyBlocksMerge: boolean,
): Promise<void> {
  const existingId = await getCheckRunId(deps.db, target.build.id)
  const id = await deps.github?.upsertCheckRun(target.installationId, target.repoRef, {
    sha: target.build.commitSha,
    report: checkReport(mine, {
      blockMergeOnChanges: target.blockMergeOnChanges,
      flakyBlocksMerge,
    }),
    detailsUrl: mine.url,
    ...(existingId ? { existingId } : {}),
  })
  if (id && id !== existingId) await setCheckRunId(deps.db, target.build.id, id)
}
