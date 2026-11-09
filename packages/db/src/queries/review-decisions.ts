import { and, desc, eq, isNull } from 'drizzle-orm'

import {
  type ReviewSource,
  type ReviewState,
  reviews,
  snapshotReviews,
  user,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** The decisions on a build and on its snapshots, as the build page reads them. */

/** The current decision on a snapshot of a build. */
export interface SnapshotReviewEntry {
  name: string
  decision: ReviewState
  /** Null for automatic approvals, or when the reviewer's account was deleted. */
  reviewer: { id: string; name: string } | null
  reason: string | null
  source: ReviewSource
  at: Date
}

/** The current decision on each snapshot of a build that has one, by name. */
export async function listSnapshotReviews(
  db: Database,
  buildId: string,
): Promise<SnapshotReviewEntry[]> {
  const rows = await db
    .select({
      name: snapshotReviews.snapshotName,
      decision: snapshotReviews.decision,
      reviewerName: user.name,
      reviewerId: snapshotReviews.userId,
      reason: snapshotReviews.reason,
      source: snapshotReviews.source,
      at: snapshotReviews.createdAt,
    })
    .from(snapshotReviews)
    .leftJoin(user, eq(user.id, snapshotReviews.userId))
    .where(and(eq(snapshotReviews.buildId, buildId), isNull(snapshotReviews.supersededAt)))
    .orderBy(snapshotReviews.snapshotName)
  return rows.map(({ reviewerId, reviewerName, ...r }) =>
    Object.assign(r, {
      reviewer: reviewerId && reviewerName !== null ? { id: reviewerId, name: reviewerName } : null,
    }),
  )
}

export interface ReviewEntry {
  state: ReviewState
  source: ReviewSource
  /** Why it was rejected, when the reviewer said. */
  reason: string | null
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
      reason: reviews.reason,
      userName: user.name,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .leftJoin(user, eq(user.id, reviews.userId))
    .where(eq(reviews.buildId, buildId))
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
  return rows
}
