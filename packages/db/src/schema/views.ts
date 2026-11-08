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
import { teams } from './teams.ts'

/**
 * A person's saved builds filters ("Your views" in the sidebar). Private to the owner. A view
 * belongs to one workspace; `team_id` null means across all of its teams.
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
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filters: jsonb('filters').$type<BuildFilterValues>().notNull().default({}),
    pinned: boolean('pinned').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique('saved_views_user_workspace_name_unique').on(t.userId, t.workspaceId, t.name),
    index('saved_views_user_workspace_idx').on(t.userId, t.workspaceId, t.position),
    check('saved_views_name_check', sql`length(btrim(${t.name})) > 0`),
  ],
)

/** Teams a person pinned to the top of their sidebar, in `position` order. */
export const userPinnedTeams = pgTable(
  'user_pinned_teams',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.teamId] })],
)
