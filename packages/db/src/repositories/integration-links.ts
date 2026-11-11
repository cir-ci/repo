import { and, eq, isNull, sql } from 'drizzle-orm'

import type { IntegrationLink } from '#queries/integration-links.ts'
import { integrationLinks } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * `integration_links`: what any integration attached to a project or a build (a Figma frame for a
 * snapshot pattern, an issue made from a build). What `kind`, `subject`, `external_ref` and
 * `payload` hold is the owning integration's business (see docs/integration-sdk.md); the two
 * kinds written today are `figma-frame` (project-wide: `subject` is the snapshot pattern,
 * `external_ref` `fileKey:nodeId`, `payload` `{ fileKey, nodeId, source, scope }`) and `issue`
 * (per build: `external_ref` is the issue key, `payload` `{ snapshotName }`).
 */

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

/** Removes one link of an integration (of one project when `projectId` is given); false when there was none. */
export async function deleteIntegrationLink(
  db: Database,
  integrationId: string,
  linkId: string,
  projectId?: string,
): Promise<boolean> {
  const rows = await db
    .delete(integrationLinks)
    .where(
      and(
        eq(integrationLinks.integrationId, integrationId),
        eq(integrationLinks.id, linkId),
        projectId ? eq(integrationLinks.projectId, projectId) : undefined,
      ),
    )
    .returning({ id: integrationLinks.id })
  return rows.length > 0
}

/**
 * Adds project-wide links, leaving any subject the project already has for the kind alone (a
 * manual link, or an earlier automatic one). Returns how many were added.
 */
export async function insertIntegrationLinksIfAbsent(
  db: Database,
  inputs: readonly (IntegrationLink.Input & { projectId: string })[],
): Promise<number> {
  if (inputs.length === 0) return 0
  const rows = await db
    .insert(integrationLinks)
    .values(
      inputs.map((input) => ({
        integrationId: input.integrationId,
        projectId: input.projectId,
        buildId: null,
        subject: input.subject ?? null,
        kind: input.kind,
        externalRef: input.externalRef,
        url: input.url ?? null,
        title: input.title ?? null,
        payload: input.payload ?? {},
        createdBy: input.createdBy ?? null,
      })),
    )
    .onConflictDoNothing({
      target: [integrationLinks.projectId, integrationLinks.kind, integrationLinks.subject],
      where: sql`${integrationLinks.buildId} is null and ${integrationLinks.projectId} is not null`,
    })
    .returning({ id: integrationLinks.id })
  return rows.length
}

/**
 * Removes the project's automatic links (`payload.source` is `auto`) of a kind, except those made
 * for `keepScope` (none given: all of them). A link's `payload.scope` is what it was made for (a
 * Figma file key): changing the project's target drops the links that no longer fit it.
 */
export async function deleteAutoLinks(
  db: Database,
  input: { projectId: string; kind: string; keepScope?: string },
): Promise<void> {
  await db
    .delete(integrationLinks)
    .where(
      and(
        eq(integrationLinks.projectId, input.projectId),
        eq(integrationLinks.kind, input.kind),
        isNull(integrationLinks.buildId),
        sql`${integrationLinks.payload} ->> 'source' = 'auto'`,
        input.keepScope
          ? sql`${integrationLinks.payload} ->> 'scope' is distinct from ${input.keepScope}`
          : undefined,
      ),
    )
}
