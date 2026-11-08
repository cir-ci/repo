import { isSlackEvent, openSecret } from '@circi/core'
import { type Database, getSlackSendData, type Job, setIntegrationAttention } from '@circi/db'
import {
  buildApprovedMessage,
  buildRejectedMessage,
  isSlackRevoked,
  reviewOverdueMessage,
  reviewRequestedMessage,
  type SlackClient,
  type SlackMessage,
} from '@circi/providers'

/**
 * The `send-slack` job: one message about one build, to the channel a project mapped (queued by
 * `queueSlackNotice` in `@circi/services`). The mapping and its event list are read again here,
 * since they may have changed since the job was queued; no mapping, or the event switched off,
 * means no message. When Slack says the token is gone, the integration is flagged as needing
 * attention (and the job ends: retrying cannot help); other failures throw so the queue retries.
 */

export namespace sendSlack {
  export interface Deps {
    db: Database
    slack: Pick<SlackClient, 'postMessage'>
    /** The instance secret, to open the sealed bot token. */
    authSecret: string
    /** The dashboard's origin, for links in messages. */
    publicOrigin: string
  }

  export type Result =
    | { status: 'skipped'; reason: string }
    | { status: 'sent'; channel: string }
    | { status: 'needs-attention'; reason: string }
}

const str = (v: unknown) => (typeof v === 'string' ? v : null)

export async function sendSlack(deps: sendSlack.Deps, job: Job): Promise<sendSlack.Result> {
  const p = job.payload
  const event = isSlackEvent(p.event) ? p.event : undefined
  if (!event || typeof p.integrationId !== 'string' || typeof p.buildId !== 'string') {
    return { status: 'skipped', reason: 'malformed job' }
  }
  const data = await getSlackSendData(deps.db, {
    integrationId: p.integrationId,
    buildId: p.buildId,
    reviewerId: str(p.reviewerId),
    actorId: str(p.actorId),
  })
  if (!data) return { status: 'skipped', reason: 'integration or build was deleted' }
  if (data.integration.needsAttention) return { status: 'skipped', reason: 'needs attention' }
  if (!data.mapping) return { status: 'skipped', reason: 'project has no channel' }
  if (!data.mapping.events.includes(event))
    return { status: 'skipped', reason: 'event switched off' }
  const token = data.integration.encryptedCredentials
    ? openSecret(deps.authSecret, data.integration.encryptedCredentials)
    : undefined
  if (!token) {
    const reason = 'The Slack token cannot be read; reinstall the Slack app'
    await setIntegrationAttention(deps.db, data.integration.id, reason)
    return { status: 'needs-attention', reason }
  }

  const build: SlackMessage.Build = {
    projectName: data.build.projectName,
    number: data.build.number,
    branch: data.build.branch,
    url: `${deps.publicOrigin}/${data.build.orgSlug}/${data.build.projectSlug}/builds/${data.build.number}`,
  }
  const who = data.reviewerName ?? 'Someone'
  const dueAt = typeof p.dueAt === 'string' ? new Date(p.dueAt) : null
  const message =
    event === 'review_requested'
      ? reviewRequestedMessage({
          build,
          reviewer: who,
          requestedBy: data.actorName,
          again: p.again === true,
          dueAt,
        })
      : event === 'review_overdue'
        ? reviewOverdueMessage({ build, reviewer: who, dueAt })
        : event === 'build_rejected'
          ? buildRejectedMessage({ build, reviewer: who, reason: str(p.reason) })
          : buildApprovedMessage({ build, reviewer: who })

  try {
    await deps.slack.postMessage(token, { channel: data.mapping.channelId, ...message })
  } catch (err) {
    if (isSlackRevoked(err)) {
      const reason = `Slack rejected the token (${err.code}); reinstall the Slack app`
      await setIntegrationAttention(deps.db, data.integration.id, reason)
      return { status: 'needs-attention', reason }
    }
    throw err
  }
  return { status: 'sent', channel: data.mapping.channelId }
}
