import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'

import { integrationLinks } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * `integration_links`: what any integration attached to a project or a build (a Figma frame for a
 * snapshot pattern, an issue made from a build). The generic replacement for `figma_links` and
 * `issue_links`; what `kind`, `subject`, `external_ref` and `payload` hold is the owning
 * integration's business (see docs/integration-sdk.md).
 */

export namespace IntegrationLink {
  export type Row = typeof integrationLinks.$inferSelect

  export interface Input {
    integrationId: string
    projectId?: string | null
    buildId?: string | null
    subject?: string | null
    kind: string
    externalRef: string
    url?: string | null
    title?: string | null
    payload?: Record<string, unknown>
    createdBy?: string | null
  }
}

/** Adds a link. A project-wide one (a project, no build) replaces the earlier one for its kind and subject. */
export async function createIntegrationLink(
  db: Database,
  input: IntegrationLink.Input,
): Promise<IntegrationLink.Row> {
  const values = {
    integrationId: input.integrationId,
    projectId: input.projectId ?? null,
    buildId: input.buildId ?? null,
    subject: input.subject ?? null,
    kind: input.kind,
    externalRef: input.externalRef,
    url: input.url ?? null,
    title: input.title ?? null,
    payload: input.payload ?? {},
    createdBy: input.createdBy ?? null,
  }
  const query = db.insert(integrationLinks).values(values)
  const [row] = await (values.projectId && !values.buildId
    ? query
        .onConflictDoUpdate({
          target: [integrationLinks.projectId, integrationLinks.kind, integrationLinks.subject],
          targetWhere: sql`${integrationLinks.buildId} is null and ${integrationLinks.projectId} is not null`,
          set: {
            integrationId: values.integrationId,
            externalRef: values.externalRef,
            url: values.url,
            title: values.title,
            payload: values.payload,
          },
        })
        .returning()
    : query.returning())
  if (!row) throw new Error('insert returned no row')
  return row
}

/** A build's links, newest first, optionally of one kind. */
export async function listBuildLinks(
  db: Database,
  buildId: string,
  kind?: string,
): Promise<IntegrationLink.Row[]> {
  return db
    .select()
    .from(integrationLinks)
    .where(
      and(
        eq(integrationLinks.buildId, buildId),
        kind ? eq(integrationLinks.kind, kind) : undefined,
      ),
    )
    .orderBy(desc(integrationLinks.createdAt), asc(integrationLinks.id))
}

/** A project's project-wide links of a kind, by subject. */
export async function listProjectLinks(
  db: Database,
  projectId: string,
  kind: string,
): Promise<IntegrationLink.Row[]> {
  return db
    .select()
    .from(integrationLinks)
    .where(
      and(
        eq(integrationLinks.projectId, projectId),
        eq(integrationLinks.kind, kind),
        isNull(integrationLinks.buildId),
      ),
    )
    .orderBy(asc(integrationLinks.subject), asc(integrationLinks.id))
}

/** Removes one link of an integration; false when there was none. */
export async function deleteIntegrationLink(
  db: Database,
  integrationId: string,
  linkId: string,
): Promise<boolean> {
  const rows = await db
    .delete(integrationLinks)
    .where(and(eq(integrationLinks.integrationId, integrationId), eq(integrationLinks.id, linkId)))
    .returning({ id: integrationLinks.id })
  return rows.length > 0
}
