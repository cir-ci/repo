import {
  type Build,
  type Database,
  enqueueJob,
  finalizeShard,
  listStalledBuilds,
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
