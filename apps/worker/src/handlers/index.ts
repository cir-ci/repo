import type { Job } from '@circi/db'
import { failBuild, GIT_NOTIFY_QUEUE, QUEUES } from '@circi/services'
import { isSiteKindId, KINDS, siteOrigin } from '@circi/sites'

import { deliverWebhook } from '../jobs/deliver-webhook.ts'
import { integrationEvent } from '../jobs/integration-event.ts'
import { notifyGit } from '../jobs/notify-git.ts'
import { processBuild } from '../jobs/process-build.ts'
import { deliverNotification } from '../jobs/send-email.ts'
import type { startWorker } from '../runner.ts'

type Deps = startWorker.Deps

/** What a handler did: `result` is logged beside the job's fields; `message` replaces `done` (a skip). */
interface Outcome {
  result?: object
  message?: string
}

/** One job kind: the adapter call, the log fields and the three log lines (done, will retry, gave up). */
interface Handler {
  fields(job: Job): object
  run(deps: Deps, job: Job): Promise<Outcome>
  done: string
  retry: string
  failed: string
  /** After the last attempt failed. */
  onGiveUp?(deps: Deps, job: Job, message: string): Promise<void>
}

const buildIdOf = (job: Job) =>
  typeof job.payload.buildId === 'string' ? job.payload.buildId : undefined

const build: Handler = {
  fields: (job) => ({ buildId: buildIdOf(job) }),
  async run(deps, job) {
    const buildId = buildIdOf(job)
    if (!buildId) throw new Error('job payload has no buildId')
    const started = Date.now()
    const result = await processBuild(
      {
        db: deps.db,
        storage: deps.storage,
        ...(deps.diffEngine ? { diffEngine: deps.diffEngine } : {}),
      },
      buildId,
    )
    return { result: { ms: Date.now() - started, ...result } }
  },
  done: 'build processed',
  retry: 'build processing failed, will retry',
  failed: 'build processing failed for good',
  async onGiveUp(deps, job, message) {
    const buildId = buildIdOf(job)
    if (buildId) await failBuild(deps.db, buildId, message).catch(() => {})
  },
}

const webhook: Handler = {
  fields: (job) => ({ webhookId: job.payload.webhookId, event: job.payload.event }),
  async run(deps, job) {
    const { db, publicOrigin, webhookAllowPrivate: allowPrivate, logger } = deps
    const warn = (obj: object | string, msg?: string) => logger.warn(obj, msg)
    return {
      result: await deliverWebhook(
        {
          db,
          warn,
          ...(publicOrigin ? { publicOrigin } : {}),
          ...(allowPrivate ? { allowPrivate } : {}),
          ...(deps.webhookTimeoutMs ? { timeoutMs: deps.webhookTimeoutMs } : {}),
        },
        job,
      ),
    }
  },
  done: 'webhook processed',
  retry: 'webhook delivery failed, will retry',
  failed: 'webhook delivery failed for good',
}

const gitNotify: Handler = {
  fields: (job) => ({ buildId: job.payload.buildId }),
  async run(deps, job) {
    const { db, integrations: context, github, providers, authSecret } = deps
    const publicOrigin = deps.publicOrigin ?? ''
    const sitesHost = deps.sitesHost
    const sites =
      sitesHost && publicOrigin
        ? {
            originFor: (label: string) => siteOrigin(publicOrigin, sitesHost, label),
            kindLabel: (kind: string) => (isSiteKindId(kind) ? KINDS[kind].label : kind),
          }
        : undefined
    return {
      result: await notifyGit(
        { db, context, github, providers, publicOrigin, authSecret, sites },
        job,
      ),
    }
  },
  done: 'git host notified',
  retry: 'could not notify the git host, will retry',
  failed: 'could not notify the git host',
}

const email: Handler = {
  fields: (job) => ({ notificationId: job.payload.notificationId }),
  async run(deps, job) {
    const { db, mailer, publicOrigin, authSecret, push } = deps
    const sender = { ...(mailer ? { mailer } : {}), ...(publicOrigin ? { publicOrigin } : {}) }
    // Web push needs the instance secret (it opens the stored signing key) and the contact.
    const web = authSecret && push ? { authSecret, ...push } : undefined
    return { result: await deliverNotification({ db, ...sender, push: web }, job) }
  },
  done: 'notification delivered',
  retry: 'could not send a notification email, will retry',
  failed: 'could not send a notification email',
}

const integration: Handler = {
  fields: (job) => {
    const event: unknown = job.payload.event
    const type =
      typeof event === 'object' && event !== null && 'type' in event ? event.type : undefined
    return { integrationId: job.payload.integrationId, event: type }
  },
  async run(deps, job) {
    const { db, integrations, authSecret, publicOrigin = '' } = deps
    if (!integrations || !authSecret) {
      return { message: 'integration event skipped: integrations are not set up in this worker' }
    }
    const { config, fetch } = integrations
    const context = { authSecret, publicOrigin, config, ...(fetch ? { fetch } : {}) }
    return { result: await integrationEvent({ db, context }, job) }
  },
  done: 'integration event processed',
  retry: 'could not deliver an integration event, will retry',
  failed: 'could not deliver an integration event',
}

/** The handler of each queue; the poll loop claims only these queues. */
export const HANDLERS: Record<string, Handler | undefined> = {
  [QUEUES.processBuild]: build,
  [QUEUES.webhook]: webhook,
  [GIT_NOTIFY_QUEUE]: gitNotify,
  [QUEUES.notificationEmail]: email,
  [QUEUES.integrationEvent]: integration,
}
