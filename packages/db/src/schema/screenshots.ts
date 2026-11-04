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
import { builds } from './builds.ts'
import { DIFF_JOB_STATUSES, DIFF_STATUSES, type DiffJobStatus, type DiffStatus } from './enums.ts'
import { files } from './files.ts'

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
    diffFileSha256: text('diff_file_sha256').references(() => files.sha256, {
      onDelete: 'restrict',
    }),
    jobStatus: text('job_status').$type<DiffJobStatus>().notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('screenshot_diffs_build_name_key').on(t.buildId, t.name),
    index('screenshot_diffs_diff_file_idx').on(t.diffFileSha256),
    check('screenshot_diffs_status_check', inListOrNull('status', DIFF_STATUSES)),
    check('screenshot_diffs_job_status_check', inList('job_status', DIFF_JOB_STATUSES)),
  ],
)
