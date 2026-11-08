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
import { apikey, organization } from './auth.ts'

export const projects = pgTable(
  'projects',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** The project's CI token: a better-auth API key owned by the org (null after revoking). */
    ciKeyId: text('ci_key_id')
      .unique()
      .references(() => apikey.id, { onDelete: 'set null' }),
    /** The git host connection (GitHub App installation) this project reports to, if any. */
    providerConnectionId: uuid('provider_connection_id'),
    /** The repository on that host, e.g. `owner/name`. */
    repoRef: text('repo_ref'),
    defaultBranch: text('default_branch').notNull().default('main'),
    diffThreshold: real('diff_threshold').notNull().default(0),
    autoApproveDefaultBranch: boolean('auto_approve_default_branch').notNull().default(true),
    blockMergeOnChanges: boolean('block_merge_on_changes').notNull().default(true),
    /**
     * Whether a change to flaky screenshots only still blocks the merge. Null inherits the
     * organization's setting (`org_settings`).
     */
    flakyBlocksMerge: boolean('flaky_blocks_merge'),
    retentionDays: integer('retention_days').notNull().default(30),
    /** Hours a review request may wait before it is overdue; null means no review target. */
    reviewTargetHours: integer('review_target_hours').default(24),
    /**
     * The first week of the triage rotation (any moment in it); null when the project has no
     * rotation. Who is on triage comes from `triage_rotation_members` in this order.
     */
    triageRotationStartsOn: timestamp('triage_rotation_starts_on', { withTimezone: true }),
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
    check(
      'projects_review_target_hours_check',
      sql`${t.reviewTargetHours} is null or ${t.reviewTargetHours} >= 1`,
    ),
  ],
)
