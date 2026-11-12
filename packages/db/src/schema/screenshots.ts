import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { createdAt, id, inList, inListOrNull } from './_columns.ts'
import { user } from './auth.ts'
import { builds } from './builds.ts'
import { DIFF_JOB_STATUSES, DIFF_STATUSES, type DiffJobStatus, type DiffStatus } from './enums.ts'
import { files } from './files.ts'
import { projects } from './projects.ts'

/** A build's screenshots, and the comparison of each against the baseline. */

export const screenshots = pgTable(
  'screenshots',
  {
    id: id(),
    buildId: uuid('build_id')
      .notNull()
      .references(() => builds.id, { onDelete: 'cascade' }),
    shardIndex: text('shard_index'),
    name: text('name').notNull(),
    fileSha256: text('file_sha256')
      .notNull()
      .references(() => files.sha256, { onDelete: 'restrict' }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    /** WebP thumbnail for lists, made by the worker. */
    thumbnailSha256: text('thumbnail_sha256').references(() => files.sha256, {
      onDelete: 'restrict',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('screenshots_build_name_key').on(t.buildId, t.name),
    index('screenshots_file_idx').on(t.fileSha256),
    index('screenshots_thumbnail_idx').on(t.thumbnailSha256),
  ],
)

export const screenshotDiffs = pgTable(
  'screenshot_diffs',
  {
    id: id(),
    buildId: uuid('build_id')
      .notNull()
      .references(() => builds.id, { onDelete: 'cascade' }),
    baseScreenshotId: uuid('base_screenshot_id').references(() => screenshots.id, {
      onDelete: 'set null',
    }),
    headScreenshotId: uuid('head_screenshot_id').references(() => screenshots.id, {
      onDelete: 'cascade',
    }),
    /** Screenshot name; also present for `removed`, where there is no head screenshot. */
    name: text('name').notNull(),
    status: text('status').$type<DiffStatus>(),
    score: real('score'),
    changedPixels: integer('changed_pixels'),
    /** Dimensions differ: always `changed`, whatever the score (PLAN §7.3). */
    sizeChanged: boolean('size_changed').notNull().default(false),
    /** Why a diff `failed` (e.g. not a PNG). */
    errorMessage: text('error_message'),
    /**
     * Pixels that differed inside the project's ignore regions, which the mask hid (Insights shows
     * how many diffs the regions kept unchanged). Counted from the deploy that added the column.
     */
    ignoredChangedPixels: integer('ignored_changed_pixels').notNull().default(0),
    /** Labels of the ignore regions that hid at least one differing pixel. */
    ignoredRegions: text('ignored_regions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    diffFileSha256: text('diff_file_sha256').references(() => files.sha256, {
      onDelete: 'restrict',
    }),
    jobStatus: text('job_status').$type<DiffJobStatus>().notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('screenshot_diffs_build_name_key').on(t.buildId, t.name),
    index('screenshot_diffs_diff_file_idx').on(t.diffFileSha256),
    // Deleting a screenshot (a build's expiry) looks its diffs up by either side.
    index('screenshot_diffs_base_screenshot_idx').on(t.baseScreenshotId),
    index('screenshot_diffs_head_screenshot_idx').on(t.headScreenshotId),
    check('screenshot_diffs_status_check', inListOrNull('status', DIFF_STATUSES)),
    check('screenshot_diffs_job_status_check', inList('job_status', DIFF_JOB_STATUSES)),
  ],
)

/**
 * A rectangle to ignore when comparing the screenshots with this name in a project: something
 * that legitimately differs every run (a clock, an ad, a random avatar).
 */
export const ignoreRegions = pgTable(
  'ignore_regions',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** The screenshot name it applies to (exact match). */
    name: text('name').notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** Who added it (null for the CLI, or after the person's account is deleted). */
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('ignore_regions_project_idx').on(t.projectId, t.name),
    check(
      'ignore_regions_size_check',
      sql`${t.width} > 0 and ${t.height} > 0 and ${t.x} >= 0 and ${t.y} >= 0`,
    ),
  ],
)
