import { and, eq } from 'drizzle-orm'

import { builds, integrationTeams, integrations, workspace, teams, user } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * What delivering a domain event to integrations needs from the database: which integrations a
 * team's events could go to, and the facts a message is written from. Data only; deciding who
 * wants an event and queueing the job is `queueIntegrationEvent` in `@circi/services`, and
 * delivering it is the worker's `integration-event` job.
 */

export namespace listIntegrationEventTargets {
  export interface Target {
    integrationId: string
    /** The integration's registry id (`slack`). */
    kind: string
    /** The team's mapping: `integration_teams.external_ref` and `extra`. */
    externalRef: string
    extra: Record<string, unknown>
  }
}

/**
 * The integrations a team is mapped to, healthy ones only (an integration that needs attention
 * has credentials that no longer work). A team without a mapping has no targets.
 */
export async function listIntegrationEventTargets(
  db: Database,
  teamId: string,
): Promise<listIntegrationEventTargets.Target[]> {
  return db
    .select({
      integrationId: integrations.id,
      kind: integrations.kind,
      externalRef: integrationTeams.externalRef,
      extra: integrationTeams.extra,
    })
    .from(integrationTeams)
    .innerJoin(integrations, eq(integrations.id, integrationTeams.integrationId))
    .where(and(eq(integrationTeams.teamId, teamId), eq(integrations.needsAttention, false)))
}

export namespace getIntegrationSendData {
  export interface Data {
    integration: {
      id: string
      kind: string
      encryptedCredentials: string | null
      needsAttention: boolean
    }
    /** The team's mapping now (it may have changed since the job was queued). */
    mapping: { externalRef: string; extra: Record<string, unknown> } | null
    build: {
      id: string
      number: number
      branch: string | null
      teamName: string
      teamSlug: string
      workspaceSlug: string
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
      teamId: teams.id,
      teamName: teams.name,
      teamSlug: teams.slug,
      workspaceSlug: workspace.slug,
    })
    .from(builds)
    .innerJoin(teams, eq(teams.id, builds.teamId))
    .innerJoin(workspace, eq(workspace.id, teams.workspaceId))
    .where(eq(builds.id, input.buildId))
  if (!integration || !build) return undefined
  const [mapping] = await db
    .select({ externalRef: integrationTeams.externalRef, extra: integrationTeams.extra })
    .from(integrationTeams)
    .where(
      and(
        eq(integrationTeams.integrationId, integration.id),
        eq(integrationTeams.teamId, build.teamId),
      ),
    )
  const nameOf = async (id: string | null | undefined) => {
    if (!id) return null
    const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, id))
    return row?.name ?? null
  }
  const { teamId: _teamId, ...shown } = build
  return {
    integration,
    mapping: mapping ?? null,
    build: shown,
    reviewerName: await nameOf(input.reviewerId),
    actorName: await nameOf(input.actorId),
  }
}
