import { boolean, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

import { createdAt, id } from './_columns.ts'
import { workspace, user } from './auth.ts'
import { projects } from './projects.ts'

/**
 * A connection of a workspace to an external account: a git host installation, workspace or
 * token (GitHub, GitLab, Bitbucket), a Slack workspace, a Linear or Jira site, a Figma account.
 * Integrations belong to the workspace; projects only use them through `integration_projects`.
 */
export const integrations = pgTable(
  'integrations',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /**
     * The integration's id in the registry (`@circi/integrations`): `slack`, `linear`… Not a CHECK:
     * the registry validates it, so adding an integration needs no migration.
     */
    kind: text('kind').notNull(),
    /** What a person calls it: the workspace or site name. */
    displayName: text('display_name').notNull(),
    /** The provider's id for the account (Slack project id, Jira cloud id, GitHub installation id…). */
    externalId: text('external_id').notNull(),
    /** Sealed with `sealSecret` (`@circi/core`); never sent to the dashboard. */
    encryptedCredentials: text('encrypted_credentials'),
    needsAttention: boolean('needs_attention').notNull().default(false),
    needsAttentionReason: text('needs_attention_reason'),
    /** When it first needed attention (kept while it keeps failing); null while it works. */
    needsAttentionAt: timestamp('needs_attention_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('integrations_workspace_kind_external_key').on(t.workspaceId, t.kind, t.externalId),
  ],
)

/**
 * What a project uses an integration for: its repository-like target (a repository, a Slack
 * channel, a Linear team, a Jira project, a Figma file) in `external_ref`, anything more in `extra`. At most one per
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
  (t) => [
    unique('integration_projects_key').on(t.integrationId, t.projectId),
    index('integration_projects_project_idx').on(t.projectId),
  ],
)
