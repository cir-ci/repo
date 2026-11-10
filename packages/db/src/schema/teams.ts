import {
  DEFAULT_TEAM_RETENTION_DAYS,
  FLAKY_MIN_CHANGES,
  TEAM_COLORS,
  type TeamColor,
} from '@circi/core'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
    /** A Lucide icon name from `TEAM_ICON_NAMES`; null shows only the marble. */
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
    /** Who is also told when a review request misses its target (null: nobody besides the reviewer). */
    reviewOverdueNotifyUserId: text('review_overdue_notify_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    /** A newer build on a branch closes the older builds' review requests (superseded). */
    closeReviewsOnNewerBuild: boolean('close_reviews_on_newer_build').notNull().default(true),
    /** A newer build asks the people the older build's closed requests asked, as a re-request. */
    reRequestOnNewerBuild: boolean('re_request_on_newer_build').notNull().default(true),
    /** A build with no changes passes without anyone approving it. */
    autoApproveNoChanges: boolean('auto_approve_no_changes').notNull().default(true),
    /** Rejecting needs a written reason. */
    requireRejectReason: boolean('require_reject_reason').notNull().default(false),
    /** A screenshot is flaky after this many changes in the last `FLAKY_WINDOW` builds. */
    flakyAfterChanges: integer('flaky_after_changes').notNull().default(FLAKY_MIN_CHANGES),
    /** Days a snoozed item stays away when the snooze names no date. */
    snoozeDefaultDays: integer('snooze_default_days').notNull().default(7),
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
    check('teams_flaky_after_changes_check', sql`${t.flakyAfterChanges} between 1 and 10`),
    check('teams_snooze_default_days_check', sql`${t.snoozeDefaultDays} between 1 and 30`),
    check(
      'teams_review_target_hours_check',
      sql`${t.reviewTargetHours} is null or ${t.reviewTargetHours} >= 1`,
    ),
  ],
)

/**
 * Who belongs to a team. A team is visible to its members and to the workspace's owners and
 * admins; everyone else gets "not found". People join and leave through `@circi/services`
 * (`addTeamMembers`, `removeTeamMember`), which also take them off the team's review rules and
 * triage rotation.
 */
export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    /** Who added them; null for the migration's backfill, or after that person's account is deleted. */
    addedBy: text('added_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    index('team_members_user_idx').on(t.userId),
  ],
)
