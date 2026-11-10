import { and, asc, eq, isNull } from 'drizzle-orm'

import { integrationLinks, integrations, user } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** Reads of `integration_links` that read models share with the repository. */

export namespace IntegrationLink {
  export type Row = typeof integrationLinks.$inferSelect

  /** A link with the kind of its integration and who made it. */
  export interface Item extends Row {
    integrationKind: string
    createdByName: string | null
    createdByImage: string | null
  }

  export interface Input {
    integrationId: string
    teamId?: string | null
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

/** A build's links, oldest first, optionally of one kind. */
export async function listBuildLinks(
  db: Database,
  buildId: string,
  kind?: string,
): Promise<IntegrationLink.Item[]> {
  const rows = await db
    .select({
      link: integrationLinks,
      integrationKind: integrations.kind,
      authorName: user.name,
      authorImage: user.image,
    })
    .from(integrationLinks)
    .innerJoin(integrations, eq(integrations.id, integrationLinks.integrationId))
    .leftJoin(user, eq(user.id, integrationLinks.createdBy))
    .where(
      and(
        eq(integrationLinks.buildId, buildId),
        kind ? eq(integrationLinks.kind, kind) : undefined,
      ),
    )
    .orderBy(asc(integrationLinks.createdAt), asc(integrationLinks.id))
  return rows.map((r) =>
    Object.assign({}, r.link, {
      integrationKind: r.integrationKind,
      createdByName: r.authorName,
      createdByImage: r.authorImage,
    }),
  )
}

/** A team's team-wide links of a kind, by subject. */
export async function listTeamLinks(
  db: Database,
  teamId: string,
  kind: string,
): Promise<IntegrationLink.Row[]> {
  return db
    .select()
    .from(integrationLinks)
    .where(
      and(
        eq(integrationLinks.teamId, teamId),
        eq(integrationLinks.kind, kind),
        isNull(integrationLinks.buildId),
      ),
    )
    .orderBy(asc(integrationLinks.subject), asc(integrationLinks.id))
}
