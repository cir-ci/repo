import type { IntegrationEvent } from '@circi/core'
import { type Database } from '@circi/db'
import { getBuild } from '@circi/db/queries'
import { enqueueJob, QUEUES } from '@circi/db/queue'
import { listIntegrationEventTargets } from '@circi/db/repositories'
import { integrationRegistry, mappingHandles } from '@circi/integrations'

/**
 * Queues a domain event for every integration that wants it: the project's mappings on healthy
 * integrations whose definition handles the event and whose mapping (its event toggles) lists it.
 * One `integration-event` job per integration; the worker hands it to the definition's
 * capability. Called by the services that change something, inside their transaction, so a
 * message exists exactly when the change does. A project with no mapping gets no job at all.
 * Returns how many jobs it queued.
 */
export async function queueIntegrationEvent(
  db: Database,
  event: IntegrationEvent.Payload,
): Promise<number> {
  const build = await getBuild(db, event.buildId)
  if (!build) return 0
  const targets = await listIntegrationEventTargets(db, build.projectId)
  let queued = 0
  for (const target of targets) {
    const definition = integrationRegistry.get(target.kind)
    if (!definition || !mappingHandles(definition, target.extra, event.type)) continue
    // eslint-disable-next-line no-await-in-loop -- one transaction, one connection
    await enqueueJob(db, {
      queue: QUEUES.integrationEvent,
      payload: { integrationId: target.integrationId, event },
      dedupeKey: `integration:${event.type}:${target.integrationId}:${event.buildId}:${event.reviewerId ?? '-'}:${event.requestId ?? '-'}`,
    })
    queued += 1
  }
  return queued
}
