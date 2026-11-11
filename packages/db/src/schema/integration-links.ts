import { sql } from 'drizzle-orm'
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { createdAt, id } from './_columns.ts'
import { user } from './auth.ts'
import { builds } from './builds.ts'
import { integrations } from './integrations.ts'
import { projects } from './projects.ts'

/**
 * What an integration attached to a project or a build: a Figma frame a snapshot pattern is
 * compared with, an issue created from a build. One generic table for every integration (it
 * replaced `figma_links` and `issue_links`).
 *
 * `kind` says what the row is (`figma-frame`, `issue`), `subject` what it is about (a snapshot
 * pattern or name), `external_ref` the integration's own id for it (a Figma `fileKey:nodeId`, an
 * issue key), and `payload` anything else that kind needs. A link with a `project_id` and no
 * `build_id` is project-wide and unique per project, kind and subject.
 */
export const integrationLinks = pgTable(
  'integration_links',
  {
    id: id(),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    buildId: uuid('build_id').references(() => builds.id, { onDelete: 'cascade' }),
    subject: text('subject'),
    kind: text('kind').notNull(),
    externalRef: text('external_ref').notNull(),
    url: text('url'),
    title: text('title'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('integration_links_build_idx').on(t.buildId, t.createdAt),
    index('integration_links_integration_idx').on(t.integrationId),
    uniqueIndex('integration_links_project_subject_key')
      .on(t.projectId, t.kind, t.subject)
      .where(sql`${t.buildId} is null and ${t.projectId} is not null`),
  ],
)
