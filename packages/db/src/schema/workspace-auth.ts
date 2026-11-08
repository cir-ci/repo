import { sql } from 'drizzle-orm'
import { boolean, check, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { createdAt, id, inList } from './_columns.ts'
import { workspace, session } from './auth.ts'
import { LOGIN_METHODS } from './enums.ts'

/**
 * Which login methods a workspace accepts (PLAN §7.8). Workspaces can only narrow what
 * the instance allows. No row means everything is accepted.
 */
export const workspaceAuthSettings = pgTable('workspace_auth_settings', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  emailLoginEnabled: boolean('email_login_enabled').notNull().default(true),
  passwordLoginEnabled: boolean('password_login_enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** How each session signed in, so a workspace's rules can be applied to its content. */
export const sessionMethods = pgTable(
  'session_methods',
  {
    sessionId: text('session_id')
      .primaryKey()
      .references(() => session.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    /** For `workspace-oidc`: the only workspace this session may open. */
    scopeWorkspaceId: text('scope_workspace_id'),
  },
  (t) => [check('session_methods_method_check', inList(t.method.name, LOGIN_METHODS))],
)

/**
 * Email domains a workspace claims (PLAN §7.8). People who sign in with an address on a
 * *verified* domain join the workspace automatically. Claiming needs proof: a DNS TXT record
 * at `_circi-verify.<domain>` holding `verification_token`. A verified domain belongs to one
 * workspace only.
 */
export const workspaceDomains = pgTable(
  'workspace_domains',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    verificationToken: text('verification_token').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    /** Role new people get; only `member` for now (a constraint swap adds more). */
    autoJoinRole: text('auto_join_role').notNull().default('member'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('workspace_domains_workspace_domain_key').on(t.workspaceId, t.domain),
    uniqueIndex('workspace_domains_verified_domain_key')
      .on(t.domain)
      .where(sql`${t.verifiedAt} is not null`),
    check('workspace_domains_auto_join_role_check', inList(t.autoJoinRole.name, ['member'])),
  ],
)
