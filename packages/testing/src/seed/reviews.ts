import { type Database, type ReviewRequest, schema } from '@circi/db'

export interface SeedReviewRequestInput {
  buildId: string
  reviewerId: string
  requestedById?: string | null
  state?: ReviewRequest['state']
  /** Null for a project without a review target; unset means no due time either. */
  dueAt?: Date | null
  snoozedUntil?: Date | null
  snoozeKind?: ReviewRequest['snoozeKind']
  createdAt?: Date
}

/**
 * A review request, inserted as given: any state, due time or snooze, which `requestReview`
 * would never produce directly. Use the service when a test is about asking.
 */
export async function seedReviewRequest(
  db: Database,
  input: SeedReviewRequestInput,
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
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
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
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}
