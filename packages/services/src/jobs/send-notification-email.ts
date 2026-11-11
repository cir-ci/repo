import { type Job } from '@circi/db'
import type { Database } from '@circi/db'
import { emailPreferenceFor, getNotificationEmailData } from '@circi/db/repositories'

/** The `notification-email` job: one email about one inbox notification (B2). */

export namespace sendNotificationEmail {
  /** The part of the SMTP mailer the job needs; `@circi/auth`'s `Mailer` fits. */
  export interface Sender {
    send(mail: { to: string; subject: string; text: string }): Promise<void>
  }

  export interface Deps {
    db: Database
    /** Absent when the instance has no SMTP: the job then does nothing. */
    mailer?: sendNotificationEmail.Sender
    /** The dashboard's origin, for the link in the mail. */
    publicOrigin?: string
  }

  export type Result = { status: 'skipped'; reason: string } | { status: 'sent' }
}

/** Throws when sending fails, so the queue retries with backoff. */
export async function sendNotificationEmail(
  deps: sendNotificationEmail.Deps,
  job: Job,
): Promise<sendNotificationEmail.Result> {
  const id = job.payload.notificationId
  if (typeof id !== 'string') return { status: 'skipped', reason: 'malformed job' }
  if (!deps.mailer) return { status: 'skipped', reason: 'SMTP is not configured' }
  const data = await getNotificationEmailData(deps.db, id)
  if (!data) return { status: 'skipped', reason: 'notification was deleted' }
  const n = data.notification
  const preference = emailPreferenceFor(n.kind)
  if (!preference) return { status: 'skipped', reason: 'this kind is not emailed' }
  // The preference is checked again here: it may have been turned off since the job was queued.
  if (!data.preferences[preference]) return { status: 'skipped', reason: 'opted out' }
  if (n.deletedAt || n.readAt) return { status: 'skipped', reason: 'already handled in the inbox' }
  await deps.mailer.send({ to: data.recipient.email, ...compose(data, deps.publicOrigin ?? '') })
  return { status: 'sent' }
}

function compose(data: getNotificationEmailData.Data, origin: string) {
  const { build, actorName, recipient } = data
  const what = build
    ? `build #${build.number}${build.branch ? ` (${build.branch})` : ''} in ${build.projectName}`
    : 'a build'
  const link = build
    ? `${origin}/${build.workspaceSlug}/${build.projectSlug}/builds/${build.number}`
    : origin
  const overdue = data.notification.kind === 'review_overdue'
  const again = data.notification.kind === 'review_re_requested'
  const subject = overdue
    ? `Review overdue: ${what}`
    : `${actorName ?? 'CirCI'} ${again ? 'asked you to review again' : 'asked you to review'}: ${what}`
  // A copy to the person the project named: the reviewer is the actor.
  const copied = overdue && data.notification.payload['cc'] === true
  const lead = overdue
    ? copied
      ? `${actorName ?? 'A reviewer'}'s review of ${what} is overdue.`
      : `Your review of ${what} is overdue.`
    : `${actorName ?? 'CirCI'} asked you to review ${what}${again ? ' again' : ''}.`
  return {
    subject,
    text: [
      `Hi ${recipient.name},`,
      '',
      lead,
      '',
      link,
      '',
      'You get this email because of your CirCI notification settings. You can turn it off there.',
      '',
    ].join('\n'),
  }
}
