import { boolean, check, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'

import { createdAt, id, inList } from './_columns.ts'
import { organization, user } from './auth.ts'
import { INTEGRATION_KINDS } from './enums.ts'
import { projects } from './projects.ts'

/**
 * A connection of an organisation to something that is not a git host: a Slack workspace, a Linear
 * or Jira site, a Figma account (git hosts are `provider_connections`). Integrations belong to the
 * organisation; projects only use them through `integration_projects`.
 */
export const integrations = pgTable(
  'integrations',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** What a person calls it: the workspace or site name. */
    displayName: text('display_name').notNull(),
    /** The provider's id for the account (Slack team id, Jira cloud id…). */
    externalId: text('external_id').notNull(),
    /** Sealed with `sealSecret` (`@circi/core`); never sent to the dashboard. */
    encryptedCredentials: text('encrypted_credentials'),
    needsAttention: boolean('needs_attention').notNull().default(false),
    needsAttentionReason: text('needs_attention_reason'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('integrations_kind_check', inList(t.kind.name, INTEGRATION_KINDS)),
    unique('integrations_org_kind_external_key').on(t.orgId, t.kind, t.externalId),
  ],
)

/**
 * What a project uses an integration for: its repository-like target (a Slack channel, a Linear
 * team, a Jira project, a Figma file) in `external_ref`, anything more in `extra`. At most one per
 * project and integration.
 */
export const integrationProjects = pgTable(
  'integration_projects',
  {
    id: id(),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    externalRef: text('external_ref').notNull(),
    extra: jsonb('extra').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [unique('integration_projects_key').on(t.integrationId, t.projectId)],
)
