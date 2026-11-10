import { type Job } from '@circi/db'

import { deliverPush } from '#src/push/deliver.ts'

import { sendNotificationEmail } from './send-notification-email.ts'

/**
 * The `notification-email` job: everything that follows one inbox notification besides the
 * inbox row itself. The queue name and the payload (`{ notificationId }`) are the ones that
 * existed when it only sent email, so rows queued before a deploy are still understood.
 *
 * Rolling deploys: a server that queues this job for a push only (the person turned email off)
 * may be answered by a worker that predates push. That worker finds "opted out" or "this kind is
 * not emailed" and completes the job without sending anything, so one push can be lost during the
 * deploy, never an email twice. A new worker given a job from an old server also looks at push, which
 * is harmless: it sends only what the person's settings allow.
 */

export namespace deliverNotification {
  export interface Deps extends sendNotificationEmail.Deps {
    /** Web push settings; absent: the job only does the email. */
    push?: Omit<deliverPush.Deps, 'db'> | undefined
  }

  export interface Result {
    email: sendNotificationEmail.Result
    push: deliverPush.Result
  }
}

/**
 * The email first: it throws when sending fails, so the queue retries with backoff and the push
 * has not gone out yet. The push never throws for a push service's refusal, so it is not repeated.
 */
export async function deliverNotification(
  deps: deliverNotification.Deps,
  job: Job,
): Promise<deliverNotification.Result> {
  const email = await sendNotificationEmail(deps, job)
  const id = job.payload.notificationId
  if (typeof id !== 'string') return { email, push: { status: 'skipped', reason: 'malformed job' } }
  const push = deps.push
    ? await deliverPush({ db: deps.db, ...deps.push }, id)
    : ({ status: 'skipped', reason: 'push is not set up in this worker' } as const)
  return { email, push }
}
