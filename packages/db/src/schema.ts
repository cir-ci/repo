import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * M0/M1 schema (PLAN §6). Auth, provider and static-site tables arrive with their milestones
 * (M2, M2.5, M3.5) as separate migrations.
 *
 * Enumerations are `text` + CHECK rather than Postgres enums: adding a value is then a
 * plain constraint swap instead of an `ALTER TYPE` that can't run inside a transaction.
 */

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const id = () => uuid('id').primaryKey().defaultRandom()

const quoted = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ')
const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${quoted(values)})`)
const inListOrNull = (column: string, values: readonly string[]) =>
  sql.raw(`${column} is null or ${column} in (${quoted(values)})`)

export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export const FILE_KINDS = ['screenshot', 'diff', 'thumbnail', 'asset'] as const
export const FILE_STATUSES = ['pending', 'verified'] as const
export const BUILD_STATUSES = [
  'pending',
  'uploading',
  'processing',
  'complete',
  'error',
  'expired',
] as const
export const BUILD_CONCLUSIONS = ['no_changes', 'changes_detected'] as const
export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const
export const ANCESTRY_STATUSES = ['ok', 'missing', 'truncated'] as const
export const BASELINE_SOURCES = ['cli', 'sdk', 'provider', 'fallback', 'none'] as const
export const DIFF_STATUSES = ['added', 'removed', 'changed', 'unchanged', 'failed'] as const
export const DIFF_JOB_STATUSES = ['pending', 'running', 'done', 'failed'] as const
export const REVIEW_STATES = ['approved', 'rejected'] as const
export const REVIEW_SOURCES = ['ui', 'github-check', 'github-comment', 'auto'] as const

export type Role = (typeof ROLES)[number]
export type FileKind = (typeof FILE_KINDS)[number]
export type BuildStatus = (typeof BUILD_STATUSES)[number]

export const organizations = pgTable('organizations', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: createdAt(),
})

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_lower_key').on(sql`lower(${t.email})`)],
)

export const memberships = pgTable(
  'memberships',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<Role>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId] }),
    index('memberships_user_idx').on(t.userId),
    check('memberships_role_check', inList('role', ROLES)),
  ],
)

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

/** Content-addressed blobs shared across builds and orgs (PLAN §8 "verify before dedup"). */
export const files = pgTable(
  'files',
  {
    sha256: text('sha256').primaryKey(),
    /** `ab/cd/<sha256>/<generation-uuid>`; a new generation after GC never collides with a delete. */
    storageKey: text('storage_key').notNull().unique(),
    kind: text('kind').$type<FileKind>().notNull(),
    status: text('status').$type<(typeof FILE_STATUSES)[number]>().notNull().default('pending'),
    size: bigint('size', { mode: 'number' }),
    width: integer('width'),
    height: integer('height'),
    contentType: text('content_type'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    gcMarkedAt: timestamp('gc_marked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check('files_sha256_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('files_kind_check', inList('kind', FILE_KINDS)),
    check('files_status_check', inList('status', FILE_STATUSES)),
    check('files_verified_check', sql`(${t.status} = 'verified') = (${t.verifiedAt} is not null)`),
    index('files_gc_marked_idx')
      .on(t.gcMarkedAt)
      .where(sql`${t.gcMarkedAt} is not null`),
  ],
)

export const builds = pgTable(
  'builds',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    name: text('name').notNull().default('default'),
    commitSha: text('commit_sha').notNull(),
    branch: text('branch'),
    prNumber: integer('pr_number'),
    baseBranch: text('base_branch'),
    mergeBaseSha: text('merge_base_sha'),
    ancestorShas: text('ancestor_shas')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ancestryStatus: text('ancestry_status')
      .$type<(typeof ANCESTRY_STATUSES)[number]>()
      .notNull()
      .default('missing'),
    baselineSource: text('baseline_source').$type<(typeof BASELINE_SOURCES)[number]>(),
    baseBuildId: uuid('base_build_id').references((): AnyPgColumn => builds.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<BuildStatus>().notNull().default('pending'),
    parallelNonce: text('parallel_nonce'),
    parallelTotal: integer('parallel_total'),
    conclusion: text('conclusion').$type<(typeof BUILD_CONCLUSIONS)[number]>(),
    reviewStatus: text('review_status')
      .$type<(typeof REVIEW_STATUSES)[number]>()
      .notNull()
      .default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('builds_project_number_key').on(t.projectId, t.number),
    // Shards that start at the same moment all join one build (PLAN §7.1 step 4).
    uniqueIndex('builds_parallel_key')
      .on(t.projectId, t.name, t.commitSha, t.parallelNonce)
      .where(sql`${t.parallelNonce} is not null`),
    index('builds_project_branch_idx').on(t.projectId, t.branch, t.createdAt),
    index('builds_project_name_commit_idx').on(t.projectId, t.name, t.commitSha),
    check('builds_status_check', inList('status', BUILD_STATUSES)),
    check('builds_review_status_check', inList('review_status', REVIEW_STATUSES)),
    check('builds_ancestry_status_check', inList('ancestry_status', ANCESTRY_STATUSES)),
    check('builds_conclusion_check', inListOrNull('conclusion', BUILD_CONCLUSIONS)),
    check('builds_baseline_source_check', inListOrNull('baseline_source', BASELINE_SOURCES)),
    check(
      'builds_parallel_check',
      sql`(${t.parallelNonce} is null) = (${t.parallelTotal} is null) and (${t.parallelTotal} is null or ${t.parallelTotal} >= 1)`,
    ),
  ],
)

/** One row per finalized shard; a retried shard upserts instead of being counted twice. */
export const buildShards = pgTable(
  'build_shards',
  {
    buildId: uuid('build_id')
      .notNull()
      .references(() => builds.id, { onDelete: 'cascade' }),
    shardIndex: text('shard_index').notNull(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.buildId, t.shardIndex] })],
)

/** "The server told this upload it already has the file" — GC treats it as a reference. */
export const uploadClaims = pgTable(
  'upload_claims',
  {
    buildId: uuid('build_id')
      .notNull()
      .references(() => builds.id, { onDelete: 'cascade' }),
    fileSha256: text('file_sha256')
      .notNull()
      .references(() => files.sha256, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.buildId, t.fileSha256] }),
    index('upload_claims_file_idx').on(t.fileSha256),
  ],
)

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
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('screenshots_build_name_key').on(t.buildId, t.name),
    index('screenshots_file_idx').on(t.fileSha256),
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
    status: text('status').$type<(typeof DIFF_STATUSES)[number]>(),
    score: real('score'),
    diffFileSha256: text('diff_file_sha256').references(() => files.sha256, {
      onDelete: 'restrict',
    }),
    jobStatus: text('job_status')
      .$type<(typeof DIFF_JOB_STATUSES)[number]>()
      .notNull()
      .default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    index('screenshot_diffs_build_idx').on(t.buildId),
    index('screenshot_diffs_diff_file_idx').on(t.diffFileSha256),
    check('screenshot_diffs_status_check', inListOrNull('status', DIFF_STATUSES)),
    check('screenshot_diffs_job_status_check', inList('job_status', DIFF_JOB_STATUSES)),
  ],
)

export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    buildId: uuid('build_id')
      .notNull()
      .references(() => builds.id, { onDelete: 'cascade' }),
    /** Null for automatic approvals (default-branch auto-approve). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    state: text('state').$type<(typeof REVIEW_STATES)[number]>().notNull(),
    source: text('source').$type<(typeof REVIEW_SOURCES)[number]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('reviews_build_idx').on(t.buildId, t.createdAt),
    check('reviews_state_check', inList('state', REVIEW_STATES)),
    check('reviews_source_check', inList('source', REVIEW_SOURCES)),
  ],
)

/** History registered by `circi argos-env` before an Argos SDK build arrives (PLAN §7.2). */
export const commitAncestry = pgTable(
  'commit_ancestry',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    commitSha: text('commit_sha').notNull(),
    mergeBaseSha: text('merge_base_sha'),
    ancestorShas: text('ancestor_shas').array().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.commitSha] })],
)
