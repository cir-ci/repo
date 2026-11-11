import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  check,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { createdAt, id } from './_columns.ts'
import { user } from './auth.ts'
import { builds } from './builds.ts'

/**
 * Comments on a build. One about a snapshot may point at a region of it (`region_*`, fractions of
 * the snapshot's width and height, so they hold at any size); a reply has a parent and none of
 * those. Deleting is soft (`deleted_at`) so a thread keeps its shape; reads blank the body.
 */

export const comments = pgTable(
  'comments',
  {
    id: id(),
    buildId: uuid('build_id')
      .notNull()
      .references(() => builds.id, { onDelete: 'cascade' }),
    /** The snapshot it is about; null for a comment on the build as a whole. */
    snapshotName: text('snapshot_name'),
    regionX: doublePrecision('region_x'),
    regionY: doublePrecision('region_y'),
    regionWidth: doublePrecision('region_width'),
    regionHeight: doublePrecision('region_height'),
    /** Which image of the snapshot the region was drawn on; old rows and clients default to 'current'. */
    regionSide: text('region_side', { enum: ['baseline', 'current'] })
      .notNull()
      .default('current'),
    body: text('body').notNull(),
    /** Null when the author's account was deleted. */
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    /** The author's display name when the comment was written; shown once the account is gone. */
    authorName: text('author_name'),
    /** The comment this replies to; threads are one level deep. */
    parentId: uuid('parent_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'cascade',
    }),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('comments_build_idx').on(t.buildId, t.createdAt),
    index('comments_parent_idx').on(t.parentId),
    // A region is all four numbers or none, inside the snapshot, and needs a snapshot.
    check(
      'comments_region_check',
      sql`(${t.regionX} is null and ${t.regionY} is null and ${t.regionWidth} is null and ${t.regionHeight} is null)
        or (${t.snapshotName} is not null
          and ${t.regionX} >= 0 and ${t.regionY} >= 0
          and ${t.regionWidth} > 0 and ${t.regionHeight} > 0
          and ${t.regionX} + ${t.regionWidth} <= 1 and ${t.regionY} + ${t.regionHeight} <= 1)`,
    ),
  ],
)
