import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { createdAt, id, inList } from './_columns.ts'
import { builds } from './builds.ts'
import { REVIEW_SOURCES, REVIEW_STATES, type ReviewSource, type ReviewState } from './enums.ts'
import { users } from './organizations.ts'

/** Approve/reject history; the latest review decides a build's review status. */

export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    buildId: uuid('build_id')
      .notNull()
      .references(() => builds.id, { onDelete: 'cascade' }),
    /** Null for automatic approvals (default-branch auto-approve). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    state: text('state').$type<ReviewState>().notNull(),
    source: text('source').$type<ReviewSource>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('reviews_build_idx').on(t.buildId, t.createdAt),
    check('reviews_state_check', inList('state', REVIEW_STATES)),
    check('reviews_source_check', inList('source', REVIEW_SOURCES)),
  ],
)
