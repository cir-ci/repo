/**
 * Live updates: what a committed change says to the dashboards that are open, as a tiny
 * notice. The services write one per change (`emitLive` in `@circi/db/queue`, a Postgres
 * NOTIFY that is delivered when the transaction commits), every server instance hears it and
 * turns it into an event for each connected person who may see it. Notices carry IDs, never
 * data: the page refetches.
 */

/** Everything a change can say. The wire event of the same name goes to the dashboard (`Live.Event` in `@circi/api`). */
export const LIVE_NOTICE_TYPES = [
  /** A build started (or another shard of a parallel one joined). */
  'build.created',
  /** The upload finished and the build was queued for diffing. */
  'build.finalized',
  /** A build was processed, failed or was diffed again. */
  'build.updated',
  /** A decision, a review request, a snooze or a bulk review changed what a build or the review lists show. */
  'review.changed',
  /** A comment was added, edited, deleted or moved. */
  'comment.changed',
  /** Something landed in a person's inbox. */
  'notification.created',
  /** A notification was read, snoozed, brought back or deleted. */
  'notification.read',
  /** A triage item was assigned, snoozed, dismissed or opened, or an ignore region changed. */
  'triage.changed',
] as const

export type LiveNoticeType = (typeof LIVE_NOTICE_TYPES)[number]

/**
 * Notices about access, not data. They never reach the browser as events: `access.changed` makes
 * a person's open streams look at what they may see again (membership, role or workspace
 * changed), `session.ended` ends the stream of one signed-out or revoked session.
 */
export const ACCESS_NOTICE_TYPES = ['access.changed', 'session.ended'] as const

export type AccessNoticeType = (typeof ACCESS_NOTICE_TYPES)[number]

/**
 * The payload of a notice: about a project (and maybe one of its builds), or, for the inbox
 * and access types, about one person. Short keys, because Postgres limits a notification to
 * 8000 bytes and every instance receives every one. `workspaceId` (key `w`) lets a stream skip
 * a notice about a workspace its person is not in without loading anything; a notice from an
 * older server lacks it. A newer server's unknown keys and types are ignored on decode, so a
 * rolling deploy is safe in both directions.
 */
export type LiveNotice =
  | {
      type: Exclude<LiveNoticeType, 'notification.created' | 'notification.read'>
      projectId: string
      workspaceId?: string
      build?: number
    }
  | { type: 'notification.created' | 'notification.read' | 'access.changed'; userId: string }
  | { type: 'session.ended'; userId: string; sessionId: string }

export function encodeLiveNotice(notice: LiveNotice): string {
  if ('sessionId' in notice)
    return JSON.stringify({ t: notice.type, u: notice.userId, s: notice.sessionId })
  if ('userId' in notice) return JSON.stringify({ t: notice.type, u: notice.userId })
  return JSON.stringify({
    t: notice.type,
    p: notice.projectId,
    ...(notice.workspaceId === undefined ? {} : { w: notice.workspaceId }),
    ...(notice.build === undefined ? {} : { b: notice.build }),
  })
}

const isType = (value: unknown): value is LiveNoticeType =>
  LIVE_NOTICE_TYPES.some((t) => t === value)

/** A notice from its payload, or undefined for anything else (a payload from a newer version is ignored, not an error). */
export function decodeLiveNotice(payload: string): LiveNotice | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(payload)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const type: unknown = Reflect.get(raw, 't')
  const project: unknown = Reflect.get(raw, 'p')
  const workspace: unknown = Reflect.get(raw, 'w')
  const user: unknown = Reflect.get(raw, 'u')
  const session: unknown = Reflect.get(raw, 's')
  const build: unknown = Reflect.get(raw, 'b')
  if (type === 'access.changed')
    return typeof user === 'string' ? { type, userId: user } : undefined
  if (type === 'session.ended') {
    return typeof user === 'string' && typeof session === 'string'
      ? { type, userId: user, sessionId: session }
      : undefined
  }
  if (!isType(type)) return undefined
  if (type === 'notification.created' || type === 'notification.read') {
    return typeof user === 'string' ? { type, userId: user } : undefined
  }
  if (typeof project !== 'string') return undefined
  return {
    type,
    projectId: project,
    ...(typeof workspace === 'string' ? { workspaceId: workspace } : {}),
    ...(typeof build === 'number' ? { build } : {}),
  }
}
