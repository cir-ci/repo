import { check, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'

import { createdAt, id, inList } from './_columns.ts'
import { user } from './auth.ts'
import { builds } from './builds.ts'
import { FIGMA_LINK_SOURCES } from './enums.ts'
import { integrations } from './integrations.ts'
import { projects } from './projects.ts'

/**
 * A Figma frame a project's snapshots are compared with. `snapshot_pattern` is a glob over
 * screenshot names (`checkout/*`); `source` says whether CirCI matched it by name or a person
 * linked it by hand.
 */
export const figmaLinks = pgTable(
  'figma_links',
  {
    id: id(),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    snapshotPattern: text('snapshot_pattern').notNull(),
    fileKey: text('file_key').notNull(),
    nodeId: text('node_id').notNull(),
    source: text('source').notNull().default('manual'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('figma_links_source_check', inList(t.source.name, FIGMA_LINK_SOURCES)),
    unique('figma_links_project_pattern_key').on(t.projectId, t.snapshotPattern),
    index('figma_links_integration_idx').on(t.integrationId),
  ],
)

/** An issue (Linear or Jira) created from a build, optionally from one of its snapshots. */
export const issueLinks = pgTable(
  'issue_links',
  {
    id: id(),
    buildId: uuid('build_id')
      .notNull()
      .references(() => builds.id, { onDelete: 'cascade' }),
    snapshotName: text('snapshot_name'),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    /** The tracker's key: `ENG-123`, `WEB-45`. */
    issueKey: text('issue_key').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('issue_links_build_idx').on(t.buildId, t.createdAt)],
)
