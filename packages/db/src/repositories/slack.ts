import { slackEventsOf, type SlackEvent } from '@circi/core'
import { and, eq } from 'drizzle-orm'

import {
  builds,
  integrationProjects,
  integrations,
  organization,
  projects,
  user,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * What the Slack integration needs from the database: which channels a project's events go to,
 * and the facts a message is written from. Data only; queueing the job is `queueSlackNotice` in
 * `@circi/services`, and sending it is the worker's `send-slack` job.
 */

export namespace listSlackTargets {
  export interface Target {
    integrationId: string
    channelId: string
  }
}

/**
 * The channels that want `event` for a project: its mappings on healthy Slack integrations that
 * list the event. An integration that needs attention is skipped (its token no longer works), and
 * a project without a mapping has no targets, so nothing is sent for it.
 */
export async function listSlackTargets(
  db: Database,
  input: { projectId: string; event: SlackEvent },
): Promise<listSlackTargets.Target[]> {
  const rows = await db
    .select({
      integrationId: integrations.id,
      channelId: integrationProjects.externalRef,
      extra: integrationProjects.extra,
    })
    .from(integrationProjects)
    .innerJoin(integrations, eq(integrations.id, integrationProjects.integrationId))
    .where(
      and(
        eq(integrationProjects.projectId, input.projectId),
        eq(integrations.kind, 'slack'),
        eq(integrations.needsAttention, false),
      ),
    )
  return rows
    .filter((r) => slackEventsOf(r.extra).includes(input.event))
    .map((r) => ({ integrationId: r.integrationId, channelId: r.channelId }))
}

export namespace getSlackSendData {
  export interface Data {
    integration: { id: string; encryptedCredentials: string | null; needsAttention: boolean }
    /** The project's mapping now (it may have changed since the job was queued). */
    mapping: { channelId: string; events: SlackEvent[] } | null
    build: {
      number: number
      branch: string | null
      projectName: string
      projectSlug: string
      orgSlug: string
    }
    reviewerName: string | null
    actorName: string | null
  }
}

/** Everything a Slack message is written from; undefined when the integration or build is gone. */
export async function getSlackSendData(
  db: Database,
  input: {
    integrationId: string
    buildId: string
    reviewerId?: string | null
    actorId?: string | null
  },
): Promise<getSlackSendData.Data | undefined> {
  const [integration] = await db
    .select({
      id: integrations.id,
      encryptedCredentials: integrations.encryptedCredentials,
      needsAttention: integrations.needsAttention,
    })
    .from(integrations)
    .where(and(eq(integrations.id, input.integrationId), eq(integrations.kind, 'slack')))
  const [build] = await db
    .select({
      number: builds.number,
      branch: builds.branch,
      projectId: projects.id,
      projectName: projects.name,
      projectSlug: projects.slug,
      orgSlug: organization.slug,
    })
    .from(builds)
    .innerJoin(projects, eq(projects.id, builds.projectId))
    .innerJoin(organization, eq(organization.id, projects.orgId))
    .where(eq(builds.id, input.buildId))
  if (!integration || !build) return undefined
  const [mapping] = await db
    .select({ channelId: integrationProjects.externalRef, extra: integrationProjects.extra })
    .from(integrationProjects)
    .where(
      and(
        eq(integrationProjects.integrationId, integration.id),
        eq(integrationProjects.projectId, build.projectId),
      ),
    )
  const nameOf = async (id: string | null | undefined) => {
    if (!id) return null
    const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, id))
    return row?.name ?? null
  }
  const { projectId: _projectId, ...shown } = build
  return {
    integration,
    mapping: mapping
      ? { channelId: mapping.channelId, events: slackEventsOf(mapping.extra) }
      : null,
    build: shown,
    reviewerName: await nameOf(input.reviewerId),
    actorName: await nameOf(input.actorId),
  }
}

/** The organisation's Slack integration for a workspace, if it connected that one already. */
export async function findSlackIntegration(
  db: Database,
  orgId: string,
  teamId: string,
): Promise<{ id: string } | undefined> {
  const [row] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(
      and(
        eq(integrations.orgId, orgId),
        eq(integrations.kind, 'slack'),
        eq(integrations.externalId, teamId),
      ),
    )
  return row
}

/** Stores a fresh token for an integration (a reinstall) and clears "needs attention". */
export async function replaceIntegrationCredentials(
  db: Database,
  integrationId: string,
  input: { displayName: string; encryptedCredentials: string },
): Promise<void> {
  await db
    .update(integrations)
    .set({
      displayName: input.displayName,
      encryptedCredentials: input.encryptedCredentials,
      needsAttention: false,
      needsAttentionReason: null,
    })
    .where(eq(integrations.id, integrationId))
}

/** The projects of an organisation with their Slack mapping (if any) on the given integrations. */
export async function listSlackProjectMappings(
  db: Database,
  orgId: string,
): Promise<
  {
    slug: string
    name: string
    integrationId: string | null
    channelId: string | null
    extra: Record<string, unknown> | null
  }[]
> {
  const rows = await db
    .select({
      slug: projects.slug,
      name: projects.name,
      integrationId: integrations.id,
      channelId: integrationProjects.externalRef,
      extra: integrationProjects.extra,
    })
    .from(projects)
    .leftJoin(integrationProjects, eq(integrationProjects.projectId, projects.id))
    .leftJoin(
      integrations,
      and(eq(integrations.id, integrationProjects.integrationId), eq(integrations.kind, 'slack')),
    )
    .where(eq(projects.orgId, orgId))
    .orderBy(projects.name, projects.slug)
  // A project may have mappings on other kinds (Linear…): only Slack's count here.
  const bySlug = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    const had = bySlug.get(r.slug)
    if (!had || (!had.integrationId && r.integrationId)) bySlug.set(r.slug, r)
  }
  return [...bySlug.values()].map((r) =>
    r.integrationId
      ? r
      : { slug: r.slug, name: r.name, integrationId: null, channelId: null, extra: null },
  )
}
