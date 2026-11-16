import { reviewDueAt, reviewersForBuild, rotationFor } from '@circi/core'
import { type Build, type Database, type ReviewRequest, type Project } from '@circi/db'
import { getProjectById, isProjectMember, listStalledBuilds } from '@circi/db/queries'
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
import { emitBuildLive } from '#src/live/index.ts'
import { notifyFlakyDetected } from '#src/notifications/system-notices.ts'
import { notifyReviewRequested } from '#src/reviews/reviews.ts'
import { autoAssignAfterBuild } from '#src/triage/auto-assign.ts'

/**
 * What happens when a build changes state (PLAN §7.4). Each function owns one transaction: the
 * repository change, the job it implies, and the notices to webhooks and git hosts all commit
 * together or not at all, so a delivery or a check run exists exactly when the change does.
 * Repositories in `@circi/db` only store data; anything that must follow a change is decided here.
 */

/**
 * Stores one shard's screenshots; once the last shard is in, queues the build for diffing,
 * closes review requests on older builds of the same branch as superseded, and asks the people
 * the project's review rules name (else this week's person on triage) to review the build.
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
      await emitBuildLive(tx, 'build.finalized', result.build)
      const project = await getProjectById(tx, result.build.projectId)
      let superseded: ReviewRequest[] = []
      // A newer build on the branch replaces the older builds' review requests (unless the project
      // keeps them open).
      if (project?.closeReviewsOnNewerBuild !== false && result.build.branch !== null) {
        superseded = await supersedeReviewRequests(tx, {
          projectId: result.build.projectId,
          branch: result.build.branch,
          beforeNumber: result.build.number,
        })
        await clearRequestNotices(tx, superseded)
      }
      if (project) {
        await requestRuleReviewers(tx, project, result.build, options.now ?? new Date(), {
          reRequest: project.reRequestOnNewerBuild ? superseded : [],
        })
      }
    }
    return result
  })
}
/**
 * Opens a review request (asked by nobody: the system) for each reviewer the project's rules
 * name for this build, once each. A build no rule matches goes to whoever is on triage this
 * week, if the project has a rotation; with neither, nobody is asked.
 */
async function requestRuleReviewers(
  db: Database,
  project: Project,
  build: Build,
  now: Date,
  options: { reRequest: ReviewRequest[] },
): Promise<void> {
  const rules = await listRulesForResolution(db, project.id)
  let reviewerIds =
    rules.length === 0
      ? []
      : reviewersForBuild(rules, {
          name: build.name,
          snapshotNames: await listScreenshotNames(db, build.id),
        })
  if (reviewerIds.length === 0) {
    const rotation = await getRotationForResolution(db, project.id)
    const onTriage = rotation ? rotationFor(now, rotation.memberIds, rotation.startsOn) : null
    reviewerIds = onTriage ? [onTriage] : []
  }
  const dueAt = reviewDueAt(now, project.reviewTargetHours)
  // The people someone asked on the closed requests, asked again by the same person (with the
  // project's setting), if they still belong to the project and didn't write the build. Requests a rule
  // or the rotation made aren't repeated: the rules above already chose for this build.
  const again = new Map<string, string>()
  for (const old of options.reRequest) {
    if (old.requestedById === null || again.has(old.reviewerId)) continue
    if (old.reviewerId === build.authorUserId) continue
    // eslint-disable-next-line no-await-in-loop -- a few reviewers, one transaction
    if (await isProjectMember(db, project.id, old.reviewerId))
      again.set(old.reviewerId, old.requestedById)
  }
  const asked = [
    ...reviewerIds.map((reviewerId) => ({ reviewerId, requestedById: null })),
    ...[...again]
      .filter(([reviewerId]) => !reviewerIds.includes(reviewerId))
      .map(([reviewerId, requestedById]) => ({ reviewerId, requestedById })),
  ]
  for (const { reviewerId, requestedById } of asked) {
    // eslint-disable-next-line no-await-in-loop -- one transaction, a few reviewers
    const { request, created } = await openReviewRequest(db, {
      buildId: build.id,
      reviewerId,
      requestedById,
      dueAt,
    })
    if (created) {
      // eslint-disable-next-line no-await-in-loop -- one transaction, a few reviewers
      await notifyReviewRequested(
        db,
        request,
        requestedById,
        again.has(reviewerId) ? { again: true } : {},
      )
    }
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
    // The result refreshes the project's stored flaky list, which reports what it gained.
    const addedFlaky: string[] = []
    const done = await setBuildResult(tx, build, result, addedFlaky)
    await notifyFlakyDetected(tx, {
      projectId: done.projectId,
      buildId: done.id,
      names: addedFlaky,
    })
    // Nothing to review (no changes, or approved on its own): requests made at upload close. A
    // project that doesn't approve no-change builds on their own keeps those requests open.
    const project = await getProjectById(tx, done.projectId)
    const waitsForApproval =
      done.conclusion === 'no_changes' && project?.autoApproveNoChanges === false
    if (
      !waitsForApproval &&
      (done.conclusion === 'no_changes' || done.reviewStatus === 'approved')
    ) {
      await clearRequestNotices(tx, await closeReviewRequestsForBuild(tx, done.id))
    }
    await queueWebhookEvent(tx, { build: done, event: 'build.completed' })
    await queueIntegrationEvent(tx, { type: 'build.completed', buildId: done.id })
    await queueGitNotify(tx, done, integrationRegistry.gitKinds())
    await emitBuildLive(tx, 'build.updated', done)
    await autoAssignAfterBuild(tx, done)
  })
}
export namespace completeBuild {
  /** Why a finished build starts out approved without anyone clicking. */
  export type Approval = setBuildResult.Approval
}

/** Marks a build as failed and tells the git host. */
export async function failBuild(db: Database, buildId: string, message: string): Promise<void> {
  await db.transaction(async (tx) => {
    const addedFlaky: string[] = []
    const failed = await setBuildError(tx, buildId, message, addedFlaky)
    if (failed) {
      await notifyFlakyDetected(tx, {
        projectId: failed.projectId,
        buildId: failed.id,
        names: addedFlaky,
      })
      await queueGitNotify(tx, failed, integrationRegistry.gitKinds())
      await emitBuildLive(tx, 'build.updated', failed)
      await autoAssignAfterBuild(tx, failed)
    }
  })
}

/** Diffs a finished build again from scratch (`/circi rerun`). */
export async function requeueBuild(db: Database, buildId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const addedFlaky: string[] = []
    const build = await resetBuild(tx, buildId, addedFlaky)
    await notifyFlakyDetected(tx, {
      projectId: build.projectId,
      buildId: build.id,
      names: addedFlaky,
    })
    await enqueueJob(tx, { queue: QUEUES.processBuild, payload: { buildId } })
    await queueGitNotify(tx, build, integrationRegistry.gitKinds())
    await emitBuildLive(tx, 'build.updated', build)
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
 * The member an author is: the one user of the project's workspace whose linked sign-in
 * account has the claimed provider id, else the one whose verified email matches. No match, or
 * more than one, gives null: a wrong guess would show someone else's name on a build.
 */
export async function matchAuthor(
  db: Database,
  projectId: string,
  claim: AuthorClaim,
): Promise<string | null> {
  if (claim.providerId) {
    const byAccount = await findMembersByAccount(
      db,
      projectId,
      claim.provider ?? 'github',
      claim.providerId,
    )
    if (byAccount.length === 1) return byAccount[0] ?? null
    if (byAccount.length > 1) return null
  }
  if (claim.email) {
    const byEmail = await findMembersByVerifiedEmail(db, projectId, claim.email)
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
  const userId = await matchAuthor(db, input.projectId, author)
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
    projectId: string
    prNumber: number
    login: string
    providerId?: string | null
    /** The sign-in provider the author is on (`github`, `gitlab`, `bitbucket`); default `github`. */
    provider?: string
  },
): Promise<number> {
  const userId = await matchAuthor(db, input.projectId, {
    provider: input.provider ?? 'github',
    providerId: input.providerId ?? null,
  })
  return setPullRequestAuthor(db, {
    projectId: input.projectId,
    prNumber: input.prNumber,
    login: input.login,
    userId,
  })
}
