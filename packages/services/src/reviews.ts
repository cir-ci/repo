import {
  type Build,
  type Database,
  queueGitNotify,
  queueWebhookEvent,
  recordReview,
} from '@circi/db'

/**
 * Approves or rejects a build, and tells webhooks and the git host when the decision actually
 * changed something. Deciding the same thing twice is a no-op with no notices.
 */
export async function reviewBuild(db: Database, input: reviewBuild.Input): Promise<Build> {
  return db.transaction(async (tx) => {
    const { build, changed, reviewerName } = await recordReview(tx, input)
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
