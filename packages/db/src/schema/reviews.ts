import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { createdAt, id, inList } from './_columns.ts'
import { user } from './auth.ts'
import { builds } from './builds.ts'
import { REVIEW_SOURCES, REVIEW_STATES, type ReviewSource, type ReviewState } from './enums.ts'

/** Approve/reject history; the latest review decides a build's review status. */

export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    buildId: uuid('build_id')
      .notNull()
      .references(() => builds.id, { onDelete: 'cascade' }),
    /** Null for automatic approvals (default-branch auto-approve). */
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    state: text('state').$type<ReviewState>().notNull(),
    source: text('source').$type<ReviewSource>().notNull(),
    /** Why the changes were rejected, when the reviewer said. */
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [
    index('reviews_build_idx').on(t.buildId, t.createdAt),
    index('reviews_user_idx').on(t.userId),
    check('reviews_state_check', inList('state', REVIEW_STATES)),
    check('reviews_source_check', inList('source', REVIEW_SOURCES)),
  ],
)

/**
 * A decision on one snapshot (screenshot name) of a build. Rows are kept: a new decision sets
 * `superseded_at` on the one before, so the rows in `created_at` order are the timeline and the
 * rows with no `superseded_at` are the current decisions. The build's `review_status` is derived
 * from the current ones (`deriveReviewStatus` in `@circi/core`).
 */
export const snapshotReviews = pgTable(
  'snapshot_reviews',
  {
    id: id(),
    buildId: uuid('build_id')
      .notNull()
      .references(() => builds.id, { onDelete: 'cascade' }),
    /** The screenshot name, as in `screenshots.name` and `screenshot_diffs.name`. */
    snapshotName: text('snapshot_name').notNull(),
    decision: text('decision').$type<ReviewState>().notNull(),
    /** Null for automatic approvals, or when the reviewer's account was deleted. */
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    source: text('source').$type<ReviewSource>().notNull(),
    /** Why the snapshot was rejected, when the reviewer said. */
    reason: text('reason'),
    createdAt: createdAt(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('snapshot_reviews_current_key')
      .on(t.buildId, t.snapshotName)
      .where(sql`${t.supersededAt} is null`),
    index('snapshot_reviews_build_idx').on(t.buildId, t.createdAt),
    index('snapshot_reviews_user_idx').on(t.userId),
    check('snapshot_reviews_decision_check', inList('decision', REVIEW_STATES)),
    check('snapshot_reviews_source_check', inList('source', REVIEW_SOURCES)),
  ],
)
