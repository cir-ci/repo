import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { createdAt, id, inList } from './_columns.ts'
import { session, user } from './auth.ts'
import { files } from './files.ts'
import { projects } from './projects.ts'

/**
 * Hosted static sites (PLAN §7.6). A *site* belongs to a project and has a name, a kind (from the
 * registry in `@circi/sites`) and a slug that is part of its addresses. Each upload is a
 * *version* tied to a commit; addresses (hostnames) point at versions.
 */

const SITE_KINDS = [
  'storybook',
  'vitest-report',
  'playwright-report',
  'coverage',
  'docs',
  'generic',
]

export const projectSites = pgTable(
  'project_sites',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    /** Part of every address of this site; unique across the instance. */
    slug: text('slug').notNull(),
    /** Unknown paths get the entry page. */
    spa: boolean('spa').notNull().default(false),
    /**
     * One custom domain (lowercase, e.g. `storybook.acme.com`) that serves the project's default
     * branch version of this site. Unique across the instance; only a verified one is served.
     */
    customDomain: text('custom_domain'),
    /** When DNS last confirmed the domain points at this server; null until then. */
    customDomainVerifiedAt: timestamp('custom_domain_verified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('project_sites_project_name_key').on(t.projectId, t.name),
    uniqueIndex('project_sites_slug_key').on(t.slug),
    uniqueIndex('project_sites_custom_domain_key').on(t.customDomain),
    check('project_sites_kind_check', inList(t.kind.name, SITE_KINDS)),
  ],
)

export const staticSites = pgTable(
  'static_sites',
  {
    id: id(),
    projectSiteId: uuid('project_site_id')
      .notNull()
      .references(() => projectSites.id, { onDelete: 'cascade' }),
    commitSha: text('commit_sha').notNull(),
    branch: text('branch'),
    /** The page served at the root. */
    entryPath: text('entry_path').notNull().default('index.html'),
    totalBytes: integer('total_bytes').notNull(),
    fileCount: integer('file_count').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('static_sites_commit_key').on(t.projectSiteId, t.commitSha)],
)

export const staticSiteFiles = pgTable(
  'static_site_files',
  {
    staticSiteId: uuid('static_site_id')
      .notNull()
      .references(() => staticSites.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    sha256: text('sha256')
      .notNull()
      .references(() => files.sha256),
    size: integer('size').notNull(),
    contentType: text('content_type').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.staticSiteId, t.path] }),
    index('static_site_files_sha_idx').on(t.sha256),
  ],
)

/** An address: one DNS label under the sites domain, pointing at the version it serves now. */
export const siteHostnames = pgTable(
  'site_hostnames',
  {
    label: text('label').primaryKey(),
    projectSiteId: uuid('project_site_id')
      .notNull()
      .references(() => projectSites.id, { onDelete: 'cascade' }),
    /** `commit` addresses serve one version for good; `branch` ones move with the branch. */
    linkKind: text('link_kind').notNull(),
    /** For `branch`: the branch name, so a later upload can find its address again. */
    branch: text('branch'),
    staticSiteId: uuid('static_site_id')
      .notNull()
      .references(() => staticSites.id, { onDelete: 'cascade' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('site_hostnames_site_idx').on(t.projectSiteId),
    index('site_hostnames_static_site_idx').on(t.staticSiteId),
    check('site_hostnames_kind_check', inList(t.linkKind.name, ['commit', 'branch'])),
  ],
)

/**
 * Addresses retention removed: what an expired address answers with ("This site expired")
 * instead of what an address that never existed does. Only people who may open the site are told.
 * Gone with the site.
 */
export const expiredSiteHostnames = pgTable(
  'expired_site_hostnames',
  {
    label: text('label').primaryKey(),
    projectSiteId: uuid('project_site_id')
      .notNull()
      .references(() => projectSites.id, { onDelete: 'cascade' }),
    expiredAt: timestamp('expired_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('expired_site_hostnames_site_idx').on(t.projectSiteId)],
)

/** One-time tokens the dashboard hands to a site address, bound to that address, valid 60 seconds. */
export const siteTokens = pgTable(
  'site_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    label: text('label').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    authSessionId: text('auth_session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('site_tokens_user_idx').on(t.userId),
    index('site_tokens_auth_session_idx').on(t.authSessionId),
  ],
)

/**
 * What a site's own cookie stands for: a short-lived reference to a dashboard session, for one
 * address only. Checked against the dashboard session and membership at least every minute.
 */
export const siteSessions = pgTable(
  'site_sessions',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    authSessionId: text('auth_session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('site_sessions_expires_idx').on(t.expiresAt),
    index('site_sessions_user_idx').on(t.userId),
    index('site_sessions_auth_session_idx').on(t.authSessionId),
  ],
)

/**
 * One workflow run attempt's artifact import (sites published from GitHub Actions). The row is the
 * idempotency record: a redelivered webhook or a retried job finds the attempt `published` and does
 * nothing; a `failed` attempt keeps its message for the project's settings and may be tried again
 * (a redelivery after the cause was fixed). A re-run of the workflow is a new attempt.
 */
export const siteArtifactImports = pgTable(
  'site_artifact_imports',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: text('run_id').notNull(),
    runAttempt: integer('run_attempt').notNull(),
    status: text('status').notNull(),
    /** The artifact that was published, once known. */
    artifactId: text('artifact_id'),
    commitSha: text('commit_sha').notNull(),
    /** What happened, in words for a person (why it failed, or what was published). */
    message: text('message').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.runId, t.runAttempt] }),
    index('site_artifact_imports_project_idx').on(t.projectId, t.updatedAt),
    check('site_artifact_imports_status_check', inList(t.status.name, ['published', 'failed'])),
  ],
)
