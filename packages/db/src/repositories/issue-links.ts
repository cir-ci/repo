import { and, asc, eq, inArray } from 'drizzle-orm'

import { integrationProjects, integrations, issueLinks, user } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * Issues created in a tracker (Linear, Jira) from builds, and which tracker a project files them
 * in. The tracker call itself is the service's (`createIssueFromBuild`); nothing here reads or
 * opens credentials except to hand the sealed value to the caller.
 */

/** Integration kinds that are issue trackers. */
export const TRACKER_KINDS = ['linear', 'jira'] as const

export namespace IssueLink {
  export type Record = typeof issueLinks.$inferSelect

  export interface Item {
    id: string
    issueKey: string
    url: string
    title: string
    snapshotName: string | null
    integrationId: string
    kind: string
    createdAt: Date
    createdBy: { id: string; name: string } | null
  }

  /** A tracker integration a project is mapped to. */
  export interface Tracker {
    integrationId: string
    kind: string
    displayName: string
    /** The Linear team id or Jira project key. */
    externalRef: string
    needsAttention: boolean
  }
}

export async function insertIssueLink(
  db: Database,
  input: {
    buildId: string
    snapshotName?: string | null
    integrationId: string
    issueKey: string
    url: string
    title: string
    createdBy?: string | null
  },
): Promise<IssueLink.Record> {
  const [row] = await db
    .insert(issueLinks)
    .values({
      buildId: input.buildId,
      snapshotName: input.snapshotName ?? null,
      integrationId: input.integrationId,
      issueKey: input.issueKey,
      url: input.url,
      title: input.title,
      createdBy: input.createdBy ?? null,
    })
    .returning()
  if (!row) throw new Error('insert returned no row')
  return row
}

/** The issues created from a build, oldest first. */
export async function listBuildIssueLinks(
  db: Database,
  buildId: string,
): Promise<IssueLink.Item[]> {
  const rows = await db
    .select({
      link: issueLinks,
      kind: integrations.kind,
      authorName: user.name,
    })
    .from(issueLinks)
    .innerJoin(integrations, eq(integrations.id, issueLinks.integrationId))
    .leftJoin(user, eq(user.id, issueLinks.createdBy))
    .where(eq(issueLinks.buildId, buildId))
    .orderBy(asc(issueLinks.createdAt), asc(issueLinks.id))
  return rows.map(({ link, kind, authorName }) => ({
    id: link.id,
    issueKey: link.issueKey,
    url: link.url,
    title: link.title,
    snapshotName: link.snapshotName,
    integrationId: link.integrationId,
    kind,
    createdAt: link.createdAt,
    createdBy:
      link.createdBy && authorName !== null ? { id: link.createdBy, name: authorName } : null,
  }))
}

/** The trackers a project is mapped to (a Linear team or Jira project each), oldest first. */
export async function listProjectTrackers(
  db: Database,
  projectId: string,
): Promise<IssueLink.Tracker[]> {
  return db
    .select({
      integrationId: integrations.id,
      kind: integrations.kind,
      displayName: integrations.displayName,
      externalRef: integrationProjects.externalRef,
      needsAttention: integrations.needsAttention,
    })
    .from(integrationProjects)
    .innerJoin(integrations, eq(integrations.id, integrationProjects.integrationId))
    .where(
      and(
        eq(integrationProjects.projectId, projectId),
        inArray(integrations.kind, [...TRACKER_KINDS]),
      ),
    )
    .orderBy(asc(integrations.createdAt), asc(integrations.id))
}

/** A tracker integration with the project's mapping, sealed credentials included; undefined if the project is not mapped to it. */
export async function getProjectTracker(
  db: Database,
  projectId: string,
  integrationId: string,
): Promise<{ integration: typeof integrations.$inferSelect; externalRef: string } | undefined> {
  const [row] = await db
    .select({ integration: integrations, externalRef: integrationProjects.externalRef })
    .from(integrationProjects)
    .innerJoin(integrations, eq(integrations.id, integrationProjects.integrationId))
    .where(
      and(
        eq(integrationProjects.projectId, projectId),
        eq(integrationProjects.integrationId, integrationId),
        inArray(integrations.kind, [...TRACKER_KINDS]),
      ),
    )
  return row
}
