import { MAX_PARALLEL_SHARDS, ValidationError, assertFound } from '@circi/core'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { buildShards, builds, files, screenshots, uploadClaims } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError, isUniqueViolation } from '#src/errors.ts'
import type { Build } from '#src/types.ts'

/** Parallel shards: storing one shard's screenshots and counting the shards. */

const SCREENSHOT_NAME_RE = /^[^\0\n\r]{1,512}$/

/**
 * Records one shard's screenshots (PLAN §7.1 step 6). A retried shard replaces its own
 * screenshots instead of being counted twice. When every shard is in, the build moves to
 * `processing` and the processing job is enqueued in the same transaction.
 */
/**
 * Stores one shard's screenshots, and moves the build to `processing` once the last shard is
 * in. Data only: the caller (`finalizeBuild` in `@circi/services`) decides what else must happen
 * in the same transaction, such as queueing the diff job.
 */
export async function finalizeShard(
  db: Database,
  input: {
    buildId: string
    shardIndex?: string
    screenshots: finalizeShard.Screenshot[]
    /** Add to this shard's screenshots instead of replacing them (chunked uploads). */
    append?: boolean
    /** Store the screenshots but don't count the shard as finished yet. */
    hold?: boolean
  },
): Promise<finalizeShard.Result> {
  const shardIndex = input.shardIndex ?? '0'
  const names = new Set<string>()
  for (const s of input.screenshots) {
    if (!SCREENSHOT_NAME_RE.test(s.name))
      throw new ValidationError(`Invalid screenshot name "${s.name}"`)
    if (names.has(s.name)) throw new ValidationError(`Duplicate screenshot name "${s.name}"`)
    names.add(s.name)
  }
  const shas = [...new Set(input.screenshots.map((s) => s.sha256))]

  return db.transaction(async (tx) => {
    const [build] = await tx.select().from(builds).where(eq(builds.id, input.buildId)).for('update')
    assertFound(build, 'build not found')
    if (build.status !== 'uploading' && build.status !== 'pending') {
      throw new ConflictError(
        `Build #${build.number} is already ${build.status}; it can't take more screenshots`,
      )
    }

    if (shas.length > 0) {
      const verified = await tx
        .select({ sha256: files.sha256 })
        .from(files)
        .where(and(inArray(files.sha256, shas), eq(files.status, 'verified')))
      const ok = new Set(verified.map((r) => r.sha256))
      const missing = shas.filter((s) => !ok.has(s))
      if (missing.length > 0) return { status: 'missing', missing }
    }

    if (!input.append) {
      await tx
        .delete(screenshots)
        .where(and(eq(screenshots.buildId, build.id), eq(screenshots.shardIndex, shardIndex)))
    }
    if (input.screenshots.length > 0) {
      try {
        await tx.insert(screenshots).values(
          input.screenshots.map((s) => ({
            buildId: build.id,
            shardIndex,
            name: s.name,
            fileSha256: s.sha256,
            metadata: s.metadata ?? {},
          })),
        )
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError(
            'Another shard of this build already uploaded a screenshot with one of these names',
          )
        }
        throw err
      }
    }
    // Screenshots now reference these files, so the claims that protected them can go.
    if (shas.length > 0) {
      await tx
        .delete(uploadClaims)
        .where(and(eq(uploadClaims.buildId, build.id), inArray(uploadClaims.fileSha256, shas)))
    }

    if (input.hold) {
      if (build.status === 'pending') {
        await tx.update(builds).set({ status: 'uploading' }).where(eq(builds.id, build.id))
      }
      const [received = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(buildShards)
        .where(eq(buildShards.buildId, build.id))
      return {
        status: 'ok',
        complete: false,
        shardsReceived: received.count,
        shardsTotal: build.parallelTotal ?? 1,
      }
    }
    await tx
      .insert(buildShards)
      .values({ buildId: build.id, shardIndex })
      .onConflictDoUpdate({
        target: [buildShards.buildId, buildShards.shardIndex],
        set: { finalizedAt: new Date() },
      })
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(buildShards)
      .where(eq(buildShards.buildId, build.id))
    const total = build.parallelTotal ?? 1
    const complete = count >= total

    if (complete) {
      await tx
        .update(builds)
        .set({ status: 'processing', finalizedAt: new Date() })
        .where(eq(builds.id, build.id))
      await tx.delete(uploadClaims).where(eq(uploadClaims.buildId, build.id))
      return {
        status: 'ok',
        complete: true,
        shardsReceived: count,
        shardsTotal: total,
        build: { ...build, status: 'processing' },
      }
    } else if (build.status === 'pending') {
      await tx.update(builds).set({ status: 'uploading' }).where(eq(builds.id, build.id))
    }
    return { status: 'ok', complete, shardsReceived: count, shardsTotal: total }
  })
}

export namespace finalizeShard {
  export interface Screenshot {
    name: string
    sha256: string
    metadata?: Record<string, unknown>
  }

  export type Result =
    | {
        status: 'ok'
        complete: boolean
        shardsReceived: number
        shardsTotal: number
        /** The build, now `processing`, when this shard was the last one. */
        build?: Build
      }
    /** Some files aren't verified yet: the client must (re)upload them. */
    | { status: 'missing'; missing: string[] }
}

/**
 * Sets how many shards a parallel build has. Argos SDKs only learn the total when the last
 * shard reports, so a build starts with the most it could have and is corrected here.
 */
export async function setParallelTotal(
  db: Database,
  buildId: string,
  total: number,
): Promise<void> {
  const clamped = Math.min(Math.max(Math.trunc(total), 1), MAX_PARALLEL_SHARDS)
  await db
    .update(builds)
    .set({ parallelTotal: clamped })
    .where(and(eq(builds.id, buildId), inArray(builds.status, ['pending', 'uploading'])))
}
