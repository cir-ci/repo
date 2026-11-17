import {
  DEFAULT_PROJECT_RETENTION_DAYS,
  FLAKY_MIN_CHANGES,
  PROJECT_COLORS,
  type ProjectColor,
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

export const projects = pgTable(
  'projects',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** The project's CI token: a better-auth API key owned by the workspace (null after revoking). */
    ciKeyId: text('ci_key_id')
      .unique()
      .references(() => apikey.id, { onDelete: 'set null' }),
    /** Who issued the current CI token (null after the person's account is deleted, or for the first). */
    ciKeyCreatedBy: text('ci_key_created_by').references(() => user.id, { onDelete: 'set null' }),
    /** Tile colour, one of `PROJECT_COLORS`; new projects get one from a hash of their name. */
    color: text('color').$type<ProjectColor>().notNull().default('slate'),
    /** A Lucide icon name from `PROJECT_ICON_NAMES`; null shows only the marble. */
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
    /**
     * Whether new triage items go to whoever is on triage. Null inherits the workspace's setting
     * (`workspace_settings`).
     */
    assignTriageToOnCall: boolean('assign_triage_to_on_call'),
    retentionDays: integer('retention_days').notNull().default(DEFAULT_PROJECT_RETENTION_DAYS),
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
    /** A screenshot is flaky after this many flip-flops (returns to an earlier image) in the last `FLAKY_WINDOW` commits. */
    flakyAfterChanges: integer('flaky_after_changes').notNull().default(FLAKY_MIN_CHANGES),
    /** Days a snoozed item stays away when the snooze names no date. */
    snoozeDefaultDays: integer('snooze_default_days').notNull().default(7),
    /**
     * The first week of the triage rotation (any moment in it); null when the project has no
     * rotation. Who is on triage comes from `triage_rotation_members` in this order.
     */
    triageRotationStartsOn: timestamp('triage_rotation_starts_on', { withTimezone: true }),
    staticHostingEnabled: boolean('static_hosting_enabled').notNull().default(false),
    /**
     * Publish a site from the artifact a successful GitHub Actions run uploaded (no CirCI step in
     * the workflow). Needs the project linked to a GitHub repository and hosting on.
     */
    sitesFromActions: boolean('sites_from_actions').notNull().default(false),
    /** The artifact's name (`actions/upload-artifact`'s `name`). */
    sitesArtifactName: text('sites_artifact_name').notNull().default('circi-site'),
    /** The site's name, like `circi site upload --name`; null is `site`. */
    sitesArtifactSiteName: text('sites_artifact_site_name'),
    /** Last assigned per-project build number; bumped atomically when a build is created. */
    buildCounter: integer('build_counter').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('projects_workspace_slug_key').on(t.workspaceId, t.slug),
    check(
      'projects_diff_threshold_check',
      sql`${t.diffThreshold} >= 0 and ${t.diffThreshold} <= 1`,
    ),
    check('projects_color_check', inList('color', PROJECT_COLORS)),
    check('projects_retention_days_check', sql`${t.retentionDays} >= 1`),
    check('projects_flaky_after_changes_check', sql`${t.flakyAfterChanges} between 2 and 8`),
    check('projects_snooze_default_days_check', sql`${t.snoozeDefaultDays} between 1 and 30`),
    check(
      'projects_review_target_hours_check',
      sql`${t.reviewTargetHours} is null or ${t.reviewTargetHours} >= 1`,
    ),
  ],
)

/**
 * Who belongs to a project. A project is visible to its members and to the workspace's owners and
 * admins; everyone else gets "not found". People join and leave through `@circi/services`
 * (`addProjectMembers`, `removeProjectMember`), which also take them off the project's review rules and
 * triage rotation.
 */
export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    /** Who added them; null after that person's account is deleted. */
    addedBy: text('added_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index('project_members_user_idx').on(t.userId),
  ],
)
