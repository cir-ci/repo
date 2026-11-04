import { sql } from 'drizzle-orm'
import { check, index, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { createdAt, id, inList } from './_columns.ts'
import { ROLES, type Role } from './enums.ts'

/** Organizations, users and who belongs to which org (auth tables arrive in M2). */

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
