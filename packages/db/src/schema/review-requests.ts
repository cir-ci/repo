import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { createdAt, id, inList, inListOrNull } from './_columns.ts'
import { user } from './auth.ts'
import { builds } from './builds.ts'
import {
  REVIEW_REQUEST_STATES,
  type ReviewRequestState,
  SNOOZE_KINDS,
  type SnoozeKind,
} from './enums.ts'

/**
 * Someone asked to review a build. A request stays `open` until the build is reviewed (`done`),
 * a newer build on the same branch replaces it (`superseded`) or a person drops it
 * (`dismissed`). A closed request is history: asking the same person again makes a new row.
 */

export const reviewRequests = pgTable(
  'review_requests',
  {
    id: id(),
    buildId: uuid('build_id')
      .notNull()
      .references(() => builds.id, { onDelete: 'cascade' }),
    reviewerId: text('reviewer_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Null when the person who asked has since been deleted. */
    requestedById: text('requested_by_id').references(() => user.id, { onDelete: 'set null' }),
    /** The reviewer's display name when the request was made; shown once the account is gone. */
    reviewerName: text('reviewer_name').notNull(),
    /** Who asked, by name, when the request was made; null when the system asked. Outlives the account. */
    requestedByName: text('requested_by_name'),
    state: text('state').$type<ReviewRequestState>().notNull().default('open'),
    /** When the project's review target runs out; null when it had none. Fixed at request time. */
    dueAt: timestamp('due_at', { withTimezone: true }),
    /** End of a timed snooze; null for "until next push", or when not snoozed. */
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    snoozeKind: text('snooze_kind').$type<SnoozeKind>(),
    createdAt: createdAt(),
    /** When it left `open`. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    // Asking the same person about the same build twice finds the request that is already open.
    uniqueIndex('review_requests_open_key')
      .on(t.buildId, t.reviewerId)
      .where(sql`${t.state} = 'open'`),
    index('review_requests_reviewer_idx').on(t.reviewerId, t.state),
    index('review_requests_requester_idx').on(t.requestedById, t.state),
    check('review_requests_state_check', inList('state', REVIEW_REQUEST_STATES)),
    check('review_requests_snooze_kind_check', inListOrNull('snooze_kind', SNOOZE_KINDS)),
  ],
)
