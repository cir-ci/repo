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
 * What delivering a domain event to integrations needs from the database: which integrations a
 * project's events could go to, and the facts a message is written from. Data only; deciding who
 * wants an event and queueing the job is `queueIntegrationEvent` in `@circi/services`, and
 * delivering it is the worker's `integration-event` job.
 */

export namespace listIntegrationEventTargets {
  export interface Target {
    integrationId: string
    /** The integration's registry id (`slack`). */
    kind: string
    /** The project's mapping: `integration_projects.external_ref` and `extra`. */
    externalRef: string
    extra: Record<string, unknown>
  }
}

/**
 * The integrations a project is mapped to, healthy ones only (an integration that needs attention
 * has credentials that no longer work). A project without a mapping has no targets.
 */
export async function listIntegrationEventTargets(
  db: Database,
  projectId: string,
): Promise<listIntegrationEventTargets.Target[]> {
  return db
    .select({
      integrationId: integrations.id,
      kind: integrations.kind,
      externalRef: integrationProjects.externalRef,
      extra: integrationProjects.extra,
    })
    .from(integrationProjects)
    .innerJoin(integrations, eq(integrations.id, integrationProjects.integrationId))
    .where(
      and(eq(integrationProjects.projectId, projectId), eq(integrations.needsAttention, false)),
    )
}

export namespace getIntegrationSendData {
  export interface Data {
    integration: {
      id: string
      kind: string
      encryptedCredentials: string | null
      needsAttention: boolean
    }
    /** The project's mapping now (it may have changed since the job was queued). */
    mapping: { externalRef: string; extra: Record<string, unknown> } | null
    build: {
      id: string
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

/** Everything an event's message is written from; undefined when the integration or build is gone. */
export async function getIntegrationSendData(
  db: Database,
  input: {
    integrationId: string
    buildId: string
    reviewerId?: string | null
    actorId?: string | null
  },
): Promise<getIntegrationSendData.Data | undefined> {
  const [integration] = await db
    .select({
      id: integrations.id,
      kind: integrations.kind,
      encryptedCredentials: integrations.encryptedCredentials,
      needsAttention: integrations.needsAttention,
    })
    .from(integrations)
    .where(eq(integrations.id, input.integrationId))
  const [build] = await db
    .select({
      id: builds.id,
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
    .select({ externalRef: integrationProjects.externalRef, extra: integrationProjects.extra })
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
    mapping: mapping ?? null,
    build: shown,
    reviewerName: await nameOf(input.reviewerId),
    actorName: await nameOf(input.actorId),
  }
}
