import { reviewDueAt, reviewersForBuild, rotationFor } from '@circi/core'
import { type Build, type Database, type ReviewRequest } from '@circi/db'
import { getTeamById, listStalledBuilds } from '@circi/db/queries'
import { enqueueJob, QUEUES, queueGitNotify, queueWebhookEvent } from '@circi/db/queue'
import {
  closeReviewRequestsForBuild,
  createBuild,
  finalizeShard,
  findMembersByAccount,
  getRotationForResolution,
  findMembersByVerifiedEmail,
  listRulesForResolution,
  listScreenshotNames,
  markBuildNotificationsRead,
  openReviewRequest,
  resetBuild,
  setBuildError,
  setBuildResult,
  setPullRequestAuthor,
  supersedeReviewRequests,
} from '@circi/db/repositories'
import { integrationRegistry } from '@circi/integrations'

import { queueIntegrationEvent } from '#src/integration-admin/events.ts'
import { notifyReviewRequested } from '#src/reviews/reviews.ts'

/**
 * What happens when a build changes state (PLAN §7.4). Each function owns one transaction: the
 * repository change, the job it implies, and the notices to webhooks and git hosts all commit
 * together or not at all, so a delivery or a check run exists exactly when the change does.
 * Repositories in `@circi/db` only store data; anything that must follow a change is decided here.
 */

/**
 * Stores one shard's screenshots; once the last shard is in, queues the build for diffing,
 * closes review requests on older builds of the same branch as superseded, and asks the people
 * the team's review rules name (else this week's person on triage) to review the build.
 */
export async function finalizeBuild(
  db: Database,
  input: Parameters<typeof finalizeShard>[1],
  options: { now?: Date } = {},
): Promise<finalizeShard.Result> {
  return db.transaction(async (tx) => {
    const result = await finalizeShard(tx, input)
    if (result.status === 'ok' && result.build) {
      await enqueueJob(tx, {
        queue: QUEUES.processBuild,
        payload: { buildId: result.build.id },
        dedupeKey: result.build.id,
      })
      await queueGitNotify(tx, result.build, integrationRegistry.gitKinds())
      // A newer build on the branch replaces the older builds' review requests.
      if (result.build.branch !== null) {
        const superseded = await supersedeReviewRequests(tx, {
          teamId: result.build.teamId,
          branch: result.build.branch,
          beforeNumber: result.build.number,
        })
        await clearRequestNotices(tx, superseded)
      }
      await requestRuleReviewers(tx, result.build, options.now ?? new Date())
    }
    return result
  })
}
/**
 * Opens a review request (asked by nobody: the system) for each reviewer the team's rules
 * name for this build, once each. A build no rule matches goes to whoever is on triage this
 * week, if the team has a rotation; with neither, nobody is asked.
 */
async function requestRuleReviewers(db: Database, build: Build, now: Date): Promise<void> {
  const team = await getTeamById(db, build.teamId)
  if (!team) return
  const rules = await listRulesForResolution(db, team.id)
  let reviewerIds =
    rules.length === 0
      ? []
      : reviewersForBuild(rules, {
          name: build.name,
          snapshotNames: await listScreenshotNames(db, build.id),
        })
  if (reviewerIds.length === 0) {
    const rotation = await getRotationForResolution(db, team.id)
    const onTriage = rotation ? rotationFor(now, rotation.memberIds, rotation.startsOn) : null
    reviewerIds = onTriage ? [onTriage] : []
  }
  const dueAt = reviewDueAt(now, team.reviewTargetHours)
  for (const reviewerId of reviewerIds) {
    // eslint-disable-next-line no-await-in-loop -- one transaction, a few reviewers
    const { request, created } = await openReviewRequest(db, {
      buildId: build.id,
      reviewerId,
      requestedById: null,
      dueAt,
    })
    // eslint-disable-next-line no-await-in-loop -- one transaction, a few reviewers
    if (created) await notifyReviewRequested(db, request, null)
  }
}

/** Requests that closed on their own no longer need their "please review" notices. */
async function clearRequestNotices(db: Database, closed: ReviewRequest[]): Promise<void> {
  for (const request of closed) {
    // eslint-disable-next-line no-await-in-loop -- one transaction, a few reviewers
    await markBuildNotificationsRead(db, {
      userId: request.reviewerId,
      buildId: request.buildId,
      kinds: ['review_requested', 'review_re_requested', 'review_overdue'],
    })
  }
}

export namespace finalizeBuild {
  export type Screenshot = finalizeShard.Screenshot
  export type Result = finalizeShard.Result
}

/** Records a processed build's outcome and tells webhooks and the git host. */
export async function completeBuild(
  db: Database,
  build: Build,
  result: setBuildResult.Input,
): Promise<void> {
  await db.transaction(async (tx) => {
    const done = await setBuildResult(tx, build, result)
    // Nothing to review (no changes, or approved on its own): requests made at upload close.
    if (done.conclusion === 'no_changes' || done.reviewStatus === 'approved') {
      await clearRequestNotices(tx, await closeReviewRequestsForBuild(tx, done.id))
    }
    await queueWebhookEvent(tx, { build: done, event: 'build.completed' })
    await queueIntegrationEvent(tx, { type: 'build.completed', buildId: done.id })
    await queueGitNotify(tx, done, integrationRegistry.gitKinds())
  })
}
export namespace completeBuild {
  /** Why a finished build starts out approved without anyone clicking. */
  export type Approval = setBuildResult.Approval
}

/** Marks a build as failed and tells the git host. */
export async function failBuild(db: Database, buildId: string, message: string): Promise<void> {
  await db.transaction(async (tx) => {
    const failed = await setBuildError(tx, buildId, message)
    if (failed) await queueGitNotify(tx, failed, integrationRegistry.gitKinds())
  })
}

/** Diffs a finished build again from scratch (`/circi rerun`). */
export async function requeueBuild(db: Database, buildId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const build = await resetBuild(tx, buildId)
    await enqueueJob(tx, { queue: QUEUES.processBuild, payload: { buildId } })
    await queueGitNotify(tx, build, integrationRegistry.gitKinds())
  })
}

/** What went wrong with a build that stopped receiving uploads. */
export function describeStall(build: Build, receivedShards: readonly string[]): string {
  const total = build.parallelTotal
  if (!total || build.parallelNonce === null) {
    return 'The upload never finished: the CI job stopped before sending the screenshot list.'
  }
  const got = new Set(receivedShards)
  const missing = Array.from({ length: total }, (_, i) => String(i)).filter((i) => !got.has(i))
  const named =
    missing.length > 0 && missing.length <= 20
      ? `: shard ${missing.map((m) => Number(m) + 1).join(', ')}`
      : ''
  return `Timed out waiting for ${total - got.size} of ${total} shard(s)${named}. The CI job(s) that should have uploaded them probably failed or never ran.`
}

/**
 * Fails builds that were still waiting for uploads at `cutoff`, saying which shards never came,
 * so a crashed CI job shows up as an error instead of a build that stays "uploading" forever.
 * Returns how many it failed.
 */
export async function expireStalledBuilds(db: Database, cutoff: Date): Promise<number> {
  let failed = 0
  for (const { build, receivedShards } of await listStalledBuilds(db, cutoff)) {
    // eslint-disable-next-line no-await-in-loop -- each one is its own transaction
    await failBuild(db, build.id, describeStall(build, receivedShards))
    failed += 1
  }
  return failed
}

/** What a CI or git host says about who made a change. Everything is optional. */
export interface AuthorClaim {
  login?: string | null
  email?: string | null
  /** The sign-in provider the id belongs to (`github`, `gitlab`, …); default `github`. */
  provider?: string
  /** The author's id at that provider (GitHub's numeric user id), matched to a linked account. */
  providerId?: string | null
}

/**
 * The member an author is: the one user of the team's workspace whose linked sign-in
 * account has the claimed provider id, else the one whose verified email matches. No match, or
 * more than one, gives null: a wrong guess would show someone else's name on a build.
 */
export async function matchAuthor(
  db: Database,
  teamId: string,
  claim: AuthorClaim,
): Promise<string | null> {
  if (claim.providerId) {
    const byAccount = await findMembersByAccount(
      db,
      teamId,
      claim.provider ?? 'github',
      claim.providerId,
    )
    if (byAccount.length === 1) return byAccount[0] ?? null
    if (byAccount.length > 1) return null
  }
  if (claim.email) {
    const byEmail = await findMembersByVerifiedEmail(db, teamId, claim.email)
    if (byEmail.length === 1) return byEmail[0] ?? null
  }
  return null
}

/** Creates a build (or joins a parallel one) with its author matched to a member. */
export async function startBuild(
  db: Database,
  input: Omit<createBuild.Input, 'author'> & { author?: AuthorClaim },
): Promise<Build> {
  const { author, ...rest } = input
  if (!author || (!author.login && !author.email && !author.providerId)) {
    return createBuild(db, rest)
  }
  const userId = await matchAuthor(db, input.teamId, author)
  return createBuild(db, {
    ...rest,
    author: { login: author.login ?? null, email: author.email ?? null, userId },
  })
}

/**
 * A pull request's author, as the git host reports it, replaces whatever CI claimed on every
 * build of that pull request.
 */
export async function recordPullRequestAuthor(
  db: Database,
  input: {
    teamId: string
    prNumber: number
    login: string
    providerId?: string | null
    /** The sign-in provider the author is on (`github`, `gitlab`, `bitbucket`); default `github`. */
    provider?: string
  },
): Promise<number> {
  const userId = await matchAuthor(db, input.teamId, {
    provider: input.provider ?? 'github',
    providerId: input.providerId ?? null,
  })
  return setPullRequestAuthor(db, {
    teamId: input.teamId,
    prNumber: input.prNumber,
    login: input.login,
    userId,
  })
}
