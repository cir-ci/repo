import type { FlakyDecision } from '@circi/core'
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { createdAt, id, inList, inListOrNull } from './_columns.ts'
import { user } from './auth.ts'
import {
  ANCESTRY_STATUSES,
  type AncestryStatus,
  BASELINE_SOURCES,
  type BaselineSource,
  BUILD_CONCLUSIONS,
  BUILD_STATUSES,
  type BuildConclusion,
  type BuildStatus,
  REVIEW_STATUSES,
  type ReviewStatus,
} from './enums.ts'
import { projects } from './projects.ts'

/** Builds, their shards, and git history registered ahead of a build. */

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
    ancestryStatus: text('ancestry_status').$type<AncestryStatus>().notNull().default('missing'),
    baselineSource: text('baseline_source').$type<BaselineSource>(),
    baseBuildId: uuid('base_build_id').references((): AnyPgColumn => builds.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<BuildStatus>().notNull().default('pending'),
    /**
     * The key a client sent with the request that created this build, so a resend of it (after a
     * lost answer) finds the build instead of creating another. Null for a build made without one.
     */
    idempotencyKey: text('idempotency_key'),
    parallelNonce: text('parallel_nonce'),
    parallelTotal: integer('parallel_total'),
    conclusion: text('conclusion').$type<BuildConclusion>(),
    reviewStatus: text('review_status').$type<ReviewStatus>().notNull().default('pending'),
    /**
     * The flaky set this build was gated with (`FlakyDecision`), recorded when it finished with
     * changes: the status endpoint and the check read it back, so they cannot drift when a later
     * default-branch build changes the project's flaky list. Null for builds finished before this was
     * recorded (they are evaluated live against the builds before them) and for builds without changes.
     */
    flakyDecision: jsonb('flaky_decision').$type<FlakyDecision>(),
    /** Why the build ended in `error`, shown on the build page. */
    errorMessage: text('error_message'),
    /** Who made the change: the CI's actor, replaced by the git host's PR author (B1). */
    authorLogin: text('author_login'),
    authorEmail: text('author_email'),
    /** The member the author is, when their linked sign-in account matched exactly one. */
    authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('builds_project_number_key').on(t.projectId, t.number),
    // Shards that start at the same moment all join one build (PLAN §7.1 step 4).
    uniqueIndex('builds_parallel_key')
      .on(t.projectId, t.name, t.commitSha, t.parallelNonce)
      .where(sql`${t.parallelNonce} is not null`),
    uniqueIndex('builds_idempotency_key')
      .on(t.projectId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index('builds_project_branch_idx').on(t.projectId, t.branch, t.createdAt),
    index('builds_project_name_commit_idx').on(t.projectId, t.name, t.commitSha),
    index('builds_base_build_idx').on(t.baseBuildId),
    index('builds_author_user_idx').on(t.authorUserId),
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
