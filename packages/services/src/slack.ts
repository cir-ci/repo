import type { SlackEvent } from '@circi/core'
import { type Database, enqueueJob, getBuild, listSlackTargets, QUEUES } from '@circi/db'

/**
 * Queues the Slack messages for something that happened to a build, one job per channel that
 * wants it (`send-slack` in the worker sends them). Called by the services that change something,
 * inside their transaction, so a message exists exactly when the change does. A project with no
 * Slack channel (or whose channel does not list the event) gets no job at all.
 */
export async function queueSlackNotice(
  db: Database,
  input: queueSlackNotice.Input,
): Promise<number> {
  const build = await getBuild(db, input.buildId)
  if (!build) return 0
  const targets = await listSlackTargets(db, { projectId: build.projectId, event: input.event })
  for (const target of targets) {
    // eslint-disable-next-line no-await-in-loop -- one transaction, one connection
    await enqueueJob(db, {
      queue: QUEUES.slack,
      payload: {
        event: input.event,
        integrationId: target.integrationId,
        buildId: input.buildId,
        reviewerId: input.reviewerId ?? null,
        actorId: input.actorId ?? null,
        reason: input.reason ?? null,
        dueAt: input.dueAt?.toISOString() ?? null,
        again: input.again === true,
      },
      dedupeKey: `slack:${input.event}:${target.integrationId}:${input.buildId}:${input.reviewerId ?? '-'}:${input.requestId ?? '-'}`,
    })
  }
  return targets.length
}
export namespace queueSlackNotice {
  export interface Input {
    event: SlackEvent
    buildId: string
    /** Who was asked to review (requested, overdue) or who decided (rejected, approved). */
    reviewerId?: string | null
    /** Who asked, for a review request. */
    actorId?: string | null
    /** The review request, so a later request for the same build and reviewer is not deduplicated. */
    requestId?: string
    reason?: string | null
    dueAt?: Date | null
    /** A request to someone who had asked before. */
    again?: boolean
  }
}
