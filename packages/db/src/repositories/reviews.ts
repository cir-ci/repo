import { desc, eq } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import { builds, type ReviewSource, type ReviewState, reviews, user } from '../schema/index.ts'
import type { Build } from '../types.ts'

/**
 * Approving and rejecting builds (PLAN §7.4). Every decision is kept as a row; the latest one is
 * the build's `review_status`, which is what makes an approved build a baseline for later builds
 * and what the merge gate reads.
 */

export interface ReviewBuildInput {
  buildId: string
  userId: string
  state: ReviewState
  source?: ReviewSource
}

/**
 * Records a decision on a build. Only a finished build with changes can be reviewed: there's
 * nothing to decide while it's processing, or when it matched its baseline. Deciding the same
 * thing again is a no-op, so a double click doesn't pile up history; changing your mind is fine.
 */
export async function reviewBuild(db: Database, input: ReviewBuildInput): Promise<Build> {
  return db.transaction(async (tx) => {
    const [build] = await tx.select().from(builds).where(eq(builds.id, input.buildId)).for('update')
    if (!build) throw new NotFoundError('Build not found')
    if (build.status !== 'complete') {
      throw new ConflictError(
        `Build #${build.number} is ${build.status}; it can be reviewed once it's complete`,
      )
    }
    if (build.conclusion !== 'changes_detected') {
      throw new ConflictError(`Build #${build.number} has no changes to review`)
    }
    if (build.reviewStatus === input.state) return build

    await tx.insert(reviews).values({
      buildId: build.id,
      userId: input.userId,
      state: input.state,
      source: input.source ?? 'ui',
    })
    const [updated] = await tx
      .update(builds)
      .set({ reviewStatus: input.state })
      .where(eq(builds.id, build.id))
      .returning()
    if (!updated) throw new Error('update returned no row')
    return updated
  })
}

export interface ReviewEntry {
  state: ReviewState
  source: ReviewSource
  /** Null for automatic approvals, or when the reviewer's account was deleted. */
  userName: string | null
  createdAt: Date
}

/** A build's decisions, newest first. */
export async function listBuildReviews(db: Database, buildId: string): Promise<ReviewEntry[]> {
  const rows = await db
    .select({
      state: reviews.state,
      source: reviews.source,
      userName: user.name,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .leftJoin(user, eq(user.id, reviews.userId))
    .where(eq(reviews.buildId, buildId))
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
  return rows
}
