import { isIntegrationEvent, type IntegrationEvent, openSecret } from '@circi/core'
import { type Database, getIntegrationSendData, type Job, setIntegrationAttention } from '@circi/db'
import {
  type IntegrationDefinition,
  integrationRegistry,
  mappingHandles,
} from '@circi/integrations'

/**
 * The `integration-event` job: one domain event for one integration (queued by
 * `queueIntegrationEvent` in `@circi/services`), handed to the definition's capability (`chat.send`
 * for Slack). The mapping and its event toggles are read again here, since they may have changed
 * since the job was queued; no mapping, or the event switched off, means nothing is sent. When the
 * definition's `needsAttention` classifier says a person has to act (a revoked token), the
 * integration is flagged and the job ends (retrying cannot help); any other failure throws so the
 * queue retries.
 */

export namespace integrationEvent {
  export interface Deps {
    db: Database
    context: IntegrationDefinition.Context
  }

  export type Result =
    | { status: 'skipped'; reason: string }
    | { status: 'sent'; kind: string }
    | { status: 'needs-attention'; reason: string }
}

const str = (v: unknown) => (typeof v === 'string' ? v : null)

/** The event out of a job payload; undefined for a malformed one. */
function eventOf(payload: Record<string, unknown>): IntegrationEvent.Payload | undefined {
  const e = payload.event
  if (typeof e !== 'object' || e === null) return undefined
  const raw: Record<string, unknown> = { ...e }
  if (!isIntegrationEvent(raw.type) || typeof raw.buildId !== 'string') return undefined
  return {
    type: raw.type,
    buildId: raw.buildId,
    reviewerId: str(raw.reviewerId),
    actorId: str(raw.actorId),
    requestId: str(raw.requestId),
    reason: str(raw.reason),
    dueAt: str(raw.dueAt),
    again: raw.again === true,
  }
}

export async function integrationEvent(
  deps: integrationEvent.Deps,
  job: Job,
): Promise<integrationEvent.Result> {
  const event = eventOf(job.payload)
  if (!event || typeof job.payload.integrationId !== 'string') {
    return { status: 'skipped', reason: 'malformed job' }
  }
  const data = await getIntegrationSendData(deps.db, {
    integrationId: job.payload.integrationId,
    buildId: event.buildId,
    reviewerId: event.reviewerId ?? null,
    actorId: event.actorId ?? null,
  })
  if (!data) return { status: 'skipped', reason: 'integration or build was deleted' }
  const definition = integrationRegistry.get(data.integration.kind)
  const chat = definition?.capabilities.chat
  if (!definition || !chat) return { status: 'skipped', reason: 'integration kind cannot send' }
  if (data.integration.needsAttention) return { status: 'skipped', reason: 'needs attention' }
  if (!data.mapping) return { status: 'skipped', reason: 'team is not mapped' }
  if (!mappingHandles(definition, data.mapping.extra, event.type)) {
    return { status: 'skipped', reason: 'event switched off' }
  }
  const credentials = data.integration.encryptedCredentials
    ? openSecret(deps.context.authSecret, data.integration.encryptedCredentials)
    : undefined
  if (!credentials) {
    const reason = `The ${definition.name} credentials cannot be read; connect it again`
    await setIntegrationAttention(deps.db, data.integration.id, reason)
    return { status: 'needs-attention', reason }
  }

  try {
    await chat.send(
      {
        event,
        build: {
          teamName: data.build.teamName,
          number: data.build.number,
          branch: data.build.branch,
          url: `${deps.context.publicOrigin}/${data.build.workspaceSlug}/${data.build.teamSlug}/builds/${data.build.number}`,
        },
        reviewer: data.reviewerName,
        actor: data.actorName,
        target: { ref: data.mapping.externalRef, extra: data.mapping.extra },
        credentials,
      },
      deps.context,
    )
  } catch (err) {
    const reason = definition.needsAttention(err)
    if (reason) {
      await setIntegrationAttention(deps.db, data.integration.id, reason)
      return { status: 'needs-attention', reason }
    }
    throw err
  }
  return { status: 'sent', kind: definition.id }
}
