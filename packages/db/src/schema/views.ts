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
import { workspace, user } from './auth.ts'
import { projects } from './projects.ts'

/**
 * A person's saved builds filters ("Your views" in the sidebar). Private to the owner. A view
 * belongs to one workspace; `project_id` null means across all of its projects.
 */
export const savedViews = pgTable(
  'saved_views',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filters: jsonb('filters').$type<BuildFilterValues>().notNull().default({}),
    pinned: boolean('pinned').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique('saved_views_user_workspace_name_unique').on(t.userId, t.workspaceId, t.name),
    index('saved_views_user_workspace_idx').on(t.userId, t.workspaceId, t.position),
    index('saved_views_workspace_idx').on(t.workspaceId),
    index('saved_views_project_idx').on(t.projectId),
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
  (t) => [
    primaryKey({ columns: [t.userId, t.projectId] }),
    index('user_pinned_projects_project_idx').on(t.projectId),
  ],
)
