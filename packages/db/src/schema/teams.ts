import { DEFAULT_TEAM_RETENTION_DAYS, TEAM_COLORS, type TeamColor } from '@circi/core'
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
} from 'drizzle-orm/pg-core'

import { createdAt, id, inList } from './_columns.ts'
import { apikey, user, workspace } from './auth.ts'

export const teams = pgTable(
  'teams',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** The team's CI token: a better-auth API key owned by the workspace (null after revoking). */
    ciKeyId: text('ci_key_id')
      .unique()
      .references(() => apikey.id, { onDelete: 'set null' }),
    /** Who issued the current CI token (null after the person's account is deleted, or for the first). */
    ciKeyCreatedBy: text('ci_key_created_by').references(() => user.id, { onDelete: 'set null' }),
    /** Tile colour, one of `TEAM_COLORS`; new teams get one from a hash of their name. */
    color: text('color').$type<TeamColor>().notNull().default('slate'),
    /** A Lucide icon name from `TEAM_ICON_NAMES`; null shows the team's first letter. */
    icon: text('icon'),
    defaultBranch: text('default_branch').notNull().default('main'),
    diffThreshold: real('diff_threshold').notNull().default(0),
    autoApproveDefaultBranch: boolean('auto_approve_default_branch').notNull().default(true),
    blockMergeOnChanges: boolean('block_merge_on_changes').notNull().default(true),
    /**
     * Whether a change to flaky screenshots only still blocks the merge. Null inherits the
     * workspace's setting (`workspace_settings`).
     */
    flakyBlocksMerge: boolean('flaky_blocks_merge'),
    retentionDays: integer('retention_days').notNull().default(DEFAULT_TEAM_RETENTION_DAYS),
    /** Hours a review request may wait before it is overdue; null means no review target. */
    reviewTargetHours: integer('review_target_hours').default(24),
    /**
     * The first week of the triage rotation (any moment in it); null when the team has no
     * rotation. Who is on triage comes from `triage_rotation_members` in this order.
     */
    triageRotationStartsOn: timestamp('triage_rotation_starts_on', { withTimezone: true }),
    staticHostingEnabled: boolean('static_hosting_enabled').notNull().default(false),
    /** Last assigned per-team build number; bumped atomically when a build is created. */
    buildCounter: integer('build_counter').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('teams_workspace_slug_key').on(t.workspaceId, t.slug),
    check('teams_diff_threshold_check', sql`${t.diffThreshold} >= 0 and ${t.diffThreshold} <= 1`),
    check('teams_color_check', inList('color', TEAM_COLORS)),
    check('teams_retention_days_check', sql`${t.retentionDays} >= 1`),
    check(
      'teams_review_target_hours_check',
      sql`${t.reviewTargetHours} is null or ${t.reviewTargetHours} >= 1`,
    ),
  ],
)
