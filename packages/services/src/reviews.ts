import { reviewDueAt } from '@circi/core'
import {
  type Build,
  closeReviewRequestsForBuild,
  type Database,
  dismissReviewRequest as dismissRequest,
  getBuild,
  getProjectById,
  NotFoundError,
  openReviewRequest,
  queueGitNotify,
  queueWebhookEvent,
  recordReview,
  type ReviewRequest,
} from '@circi/db'

/**
 * Approves or rejects a build, and tells webhooks and the git host when the decision actually
 * changed something. Deciding the same thing twice is a no-op with no notices. Whoever was asked
 * to review the build no longer needs to: its open review requests close as done, in the same
 * transaction.
 */
export async function reviewBuild(db: Database, input: reviewBuild.Input): Promise<Build> {
  return db.transaction(async (tx) => {
    const { build, changed, reviewerName } = await recordReview(tx, input)
    await closeReviewRequestsForBuild(tx, build.id)
    if (changed) {
      await queueWebhookEvent(tx, {
        build,
        event: 'build.reviewed',
        review: { state: input.state, source: input.source ?? 'ui', userName: reviewerName },
      })
      await queueGitNotify(tx, build)
    }
    return build
  })
}
export namespace reviewBuild {
  export type Input = recordReview.Input
}

/**
 * Asks `reviewerId` to review a build. The request is due when the project's review target runs
 * out (never, for a project without one). Asking again while the request is open returns it
 * unchanged; asking after it closed opens a new one.
 */
export async function requestReview(
  db: Database,
  input: requestReview.Input,
): Promise<requestReview.Result> {
  return db.transaction(async (tx) => {
    const build = await getBuild(tx, input.buildId)
    const project = build ? await getProjectById(tx, build.projectId) : undefined
    if (!build || !project) throw new NotFoundError('Build not found')
    return openReviewRequest(tx, {
      buildId: build.id,
      reviewerId: input.reviewerId,
      requestedById: input.requestedById,
      dueAt: reviewDueAt(input.now ?? new Date(), project.reviewTargetHours),
    })
  })
}
export namespace requestReview {
  export interface Input {
    buildId: string
    reviewerId: string
    requestedById: string
    /** For tests; defaults to the current time. */
    now?: Date
  }
  export type Result = openReviewRequest.Result
}

/**
 * Drops a review request of a build in `projectId`. Only its reviewer or whoever asked may;
 * returns the request, or undefined when there was nothing of theirs to drop.
 */
export async function dismissReviewRequest(
  db: Database,
  input: { projectId: string; requestId: string; userId: string },
): Promise<ReviewRequest | undefined> {
  return db.transaction(async (tx) => dismissRequest(tx, input))
}
