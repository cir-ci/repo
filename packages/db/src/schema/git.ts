import {
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { createdAt, id, inList, inListOrNull } from './_columns.ts'
import { organization } from './auth.ts'
import { builds } from './builds.ts'
import { CONNECTION_ATTENTION, GIT_PROVIDER_KINDS } from './enums.ts'
import { projects } from './projects.ts'

/**
 * A git host an organization is connected to (PLAN §7.4). For GitHub: one installation of the
 * instance's GitHub App; projects link to it with their `repo_ref`.
 */
export const providerConnections = pgTable(
  'provider_connections',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** The host's id for the connection: the GitHub App installation id for GitHub. */
    externalId: text('external_id').notNull(),
    /**
     * Credentials for token-based hosts, sealed with `sealSecret` (`@circi/core`); null for GitHub,
     * whose App credentials are instance configuration. Never sent to the dashboard.
     */
    encryptedCredentials: text('encrypted_credentials'),
    /**
     * Why CirCI can't use this connection, set by the worker when GitHub says the installation
     * is gone (`installation_revoked`); null while it works. Cleared by the next call that
     * succeeds and when a project is linked to the installation again.
     */
    needsAttention: text('needs_attention'),
    needsAttentionAt: timestamp('needs_attention_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'provider_connections_needs_attention_check',
      inListOrNull(t.needsAttention.name, CONNECTION_ATTENTION),
    ),
    uniqueIndex('provider_connections_key').on(t.orgId, t.kind, t.externalId),
    check('provider_connections_kind_check', inList(t.kind.name, GIT_PROVIDER_KINDS)),
  ],
)

/** The check run that shows a build on its commit, so later changes update the same one. */
export const buildChecks = pgTable('build_checks', {
  buildId: uuid('build_id')
    .primaryKey()
    .references(() => builds.id, { onDelete: 'cascade' }),
  checkRunId: text('check_run_id').notNull(),
  /** When the check run was first created; shown in the build's activity. */
  createdAt: createdAt(),
})

/** The one summary comment per pull request, found again to be edited in place. */
export const prComments = pgTable(
  'pr_comments',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    prNumber: integer('pr_number').notNull(),
    commentId: text('comment_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.prNumber] })],
)

/** Webhook deliveries already handled, so GitHub's retries and replays do nothing twice. */
export const providerDeliveries = pgTable('provider_deliveries', {
  deliveryId: text('delivery_id').primaryKey(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
})
