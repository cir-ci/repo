import * as schema from '#schema/index.ts'
import { type Database, type ReviewRequest } from '#src/index.ts'

import { nextCreatedAt } from '../created-at.ts'

export namespace seedReviewRequest {
  export interface Input {
    buildId: string
    reviewerId: string
    requestedById?: string | null
    state?: ReviewRequest['state']
    /** Null for a team without a review target; unset means no due time either. */
    dueAt?: Date | null
    snoozedUntil?: Date | null
    snoozeKind?: ReviewRequest['snoozeKind']
    createdAt?: Date
    closedAt?: Date | null
  }
}

/**
 * A review request, inserted as given: any state, due time or snooze, which `requestReview`
 * would never produce directly. Use the service when a test is about asking.
 */
export async function seedReviewRequest(
  db: Database,
  input: seedReviewRequest.Input,
): Promise<ReviewRequest> {
  const [row] = await db
    .insert(schema.reviewRequests)
    .values({
      buildId: input.buildId,
      reviewerId: input.reviewerId,
      requestedById: input.requestedById ?? null,
      state: input.state ?? 'open',
      dueAt: input.dueAt ?? null,
      snoozedUntil: input.snoozedUntil ?? null,
      snoozeKind: input.snoozeKind ?? null,
      closedAt: input.closedAt ?? null,
      createdAt: input.createdAt ?? nextCreatedAt(),
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}

/** A decision on a build, inserted as given (any time or source), for history-shaped tests. */
export async function seedReview(
  db: Database,
  input: {
    buildId: string
    /** Null for an automatic approval. */
    userId: string | null
    state?: 'approved' | 'rejected'
    source?: 'ui' | 'github-check' | 'github-comment' | 'auto' | 'rerun'
    reason?: string | null
    createdAt?: Date
  },
) {
  const [row] = await db
    .insert(schema.reviews)
    .values({
      buildId: input.buildId,
      userId: input.userId,
      state: input.state ?? 'approved',
      source: input.source ?? (input.userId === null ? 'auto' : 'ui'),
      reason: input.reason ?? null,
      createdAt: input.createdAt ?? nextCreatedAt(),
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}
