import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { createdAt, id } from './_columns.ts'
import { organizations } from './organizations.ts'

export const projects = pgTable(
  'projects',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** sha256 hex of the CI token. The token itself is shown once and never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    tokenHint: text('token_hint').notNull(),
    tokenCreatedAt: timestamp('token_created_at', { withTimezone: true }).notNull().defaultNow(),
    defaultBranch: text('default_branch').notNull().default('main'),
    diffThreshold: real('diff_threshold').notNull().default(0),
    autoApproveDefaultBranch: boolean('auto_approve_default_branch').notNull().default(true),
    blockMergeOnChanges: boolean('block_merge_on_changes').notNull().default(true),
    retentionDays: integer('retention_days').notNull().default(30),
    staticHostingEnabled: boolean('static_hosting_enabled').notNull().default(false),
    /** Last assigned per-project build number; bumped atomically when a build is created. */
    buildCounter: integer('build_counter').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('projects_org_slug_key').on(t.orgId, t.slug),
    check(
      'projects_diff_threshold_check',
      sql`${t.diffThreshold} >= 0 and ${t.diffThreshold} <= 1`,
    ),
    check('projects_retention_days_check', sql`${t.retentionDays} >= 1`),
  ],
)
