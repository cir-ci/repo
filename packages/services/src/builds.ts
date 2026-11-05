import {
  type Build,
  type Database,
  enqueueJob,
  finalizeShard,
  QUEUES,
  queueGitNotify,
  queueWebhookEvent,
  resetBuild,
  setBuildError,
  setBuildResult,
} from '@circi/db'

/**
 * What happens when a build changes state (PLAN §7.4). Each function owns one transaction: the
 * repository change, the job it implies, and the notices to webhooks and git hosts all commit
 * together or not at all, so a delivery or a check run exists exactly when the change does.
 * Repositories in `@circi/db` only store data; anything that must follow a change is decided here.
 */

/** Stores one shard's screenshots; once the last shard is in, queues the build for diffing. */
export async function finalizeBuild(
  db: Database,
  input: Parameters<typeof finalizeShard>[1],
): Promise<finalizeShard.Result> {
  return db.transaction(async (tx) => {
    const result = await finalizeShard(tx, input)
    if (result.status === 'ok' && result.build) {
      await enqueueJob(tx, {
        queue: QUEUES.processBuild,
        payload: { buildId: result.build.id },
        dedupeKey: result.build.id,
      })
      await queueGitNotify(tx, result.build)
    }
    return result
  })
}
export namespace finalizeBuild {
  export type Screenshot = finalizeShard.Screenshot
  export type Result = finalizeShard.Result
}

/** Records a processed build's outcome and tells webhooks and the git host. */
export async function completeBuild(
  db: Database,
  build: Build,
  result: { conclusion: NonNullable<Build['conclusion']>; approval: setBuildResult.Approval },
): Promise<void> {
  await db.transaction(async (tx) => {
    const done = await setBuildResult(tx, build, result)
    await queueWebhookEvent(tx, { build: done, event: 'build.completed' })
    await queueGitNotify(tx, done)
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
    if (failed) await queueGitNotify(tx, failed)
  })
}

/** Diffs a finished build again from scratch (`/circi rerun`). */
export async function requeueBuild(db: Database, buildId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const build = await resetBuild(tx, buildId)
    await enqueueJob(tx, { queue: QUEUES.processBuild, payload: { buildId } })
    await queueGitNotify(tx, build)
  })
}
