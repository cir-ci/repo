import type { BuildFilterValues } from '@circi/core'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { createdAt, id } from './_columns.ts'
import { organization, user } from './auth.ts'
import { projects } from './projects.ts'

/**
 * A person's saved builds filters ("Your views" in the sidebar). Private to the owner. A view
 * belongs to one organization; `project_id` null means across all of its projects.
 */
export const savedViews = pgTable(
  'saved_views',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filters: jsonb('filters').$type<BuildFilterValues>().notNull().default({}),
    pinned: boolean('pinned').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique('saved_views_user_org_name_unique').on(t.userId, t.orgId, t.name),
    index('saved_views_user_org_idx').on(t.userId, t.orgId, t.position),
    check('saved_views_name_check', sql`length(btrim(${t.name})) > 0`),
  ],
)

/** Projects a person pinned to the top of their sidebar, in `position` order. */
export const userPinnedProjects = pgTable(
  'user_pinned_projects',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId] })],
)
