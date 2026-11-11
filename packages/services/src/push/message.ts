import type { NotificationKind } from '@circi/db/schema'

/** The push for one notification: what the service worker shows and where a tap goes. */

export interface PushMessage {
  title: string
  body: string
  /** An app path (`/acme/web/builds/148`), opened in the app's window. */
  url: string
  /** One per notification, so a repeat replaces rather than stacks. */
  tag: string
  /** The project's name: notifications from one project group together on the lock screen. */
  project: string | null
}

export interface PushSubject {
  id: string
  kind: NotificationKind
  payload: Record<string, unknown>
  actorName: string | null
  build: {
    number: number
    branch: string | null
    projectslug: string
    projectName: string
    workspaceSlug: string
  } | null
}

/** Title says what happened; the body names the commit and project, and a rejection's reason. */
export function composePushMessage(n: PushSubject): PushMessage {
  const who = n.actorName ?? 'Someone'
  const what = n.build
    ? `#${n.build.number}${n.build.branch ? ` (${n.build.branch})` : ''}, ${n.build.projectName}`
    : 'a build'
  const url = n.build
    ? `/${n.build.workspaceSlug}/${n.build.projectslug}/builds/${n.build.number}`
    : '/'
  const rawReason = n.payload['reason']
  const reason =
    typeof rawReason === 'string' && rawReason.trim() !== '' ? `: ${rawReason.trim()}` : ''
  const parts = ((): { title: string; body: string } => {
    switch (n.kind) {
      case 'review_requested':
        return { title: 'Review requested', body: `${who} asked you to review ${what}` }
      case 'review_re_requested':
        return { title: 'Review requested again', body: `${who} asked you to review ${what} again` }
      case 'review_overdue':
        return { title: 'Overdue review', body: `Your review of ${what} is waiting` }
      case 'mentioned':
        return { title: 'Mentioned you', body: `${who} mentioned you on ${what}` }
      case 'build_approved':
        return { title: 'Approved', body: `${who} approved ${what}` }
      case 'build_rejected':
        return { title: 'Rejected', body: `${who} rejected ${what}${reason}` }
      default:
        return { title: 'CirCI', body: 'Something needs your attention' }
    }
  })()
  return { ...parts, url, tag: n.id, project: n.build?.projectName ?? null }
}
