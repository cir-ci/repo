import type { Review, Triage, Undo } from '@circi/api'
import type { QueryClient } from '@tanstack/react-query'

import { buildQuery } from '#features/builds/api/index.ts'
import { settingsQuery } from '#features/teams/api/index.ts'
import { inboxPath, teamPath } from '#lib/api-paths.ts'
import { HttpError, post, send } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'
import type { ToastInput } from '#lib/stores/toast-store.ts'
import { withUndo } from '#lib/undo.ts'

import type { ReviewSubject, RowAction, SnoozeUntil } from './entry.ts'

/**
 * What a row's action does and says. A change to the server (a decision, a request for review, an
 * assignment, a snooze, a notice read or removed) is sent at once. The answer carries a token for
 * taking it back, and the toast offers Undo: that asks the server to revert it, which it does
 * unless something newer changed the same thing (then the toast says so). Copying a link and
 * opening a tab are done on the spot.
 */

export interface ActionContext {
  queryClient: QueryClient
  /** Who is signed in, for `Assign to me`. */
  me: { id: string } | undefined
  origin: string
  copy: (text: string) => Promise<boolean>
  openTab: (url: string) => void
}

const UNTIL: Record<SnoozeUntil, string> = {
  tomorrow: 'Snoozed until tomorrow',
  next_week: 'Snoozed until next week',
}

/** Whether the team asks for a reason when someone rejects; yes when that can't be found out. */
export async function rejectNeedsReason(
  queryClient: QueryClient,
  subject: { workspace: string; team: string },
): Promise<boolean> {
  try {
    const { settings } = await queryClient.fetchQuery({
      ...settingsQuery(subject.workspace, subject.team),
      staleTime: 60_000,
    })
    return settings.requireRejectReason
  } catch {
    return true
  }
}

/** The ID of the build a subject names (the bulk request for review takes IDs, not numbers). */
async function buildIdOf(queryClient: QueryClient, subject: ReviewSubject): Promise<string> {
  const detail = await queryClient.fetchQuery(
    buildQuery(subject.workspace, subject.team, subject.number),
  )
  return detail.build.id
}

const reviewKeys = (s: ReviewSubject) =>
  [
    keys.inbox(),
    keys.reviews(),
    keys.sidebar(),
    keys.teams(),
    keys.build(s.workspace, s.team, s.number),
    keys.team(s.workspace, s.team),
    keys.triage(s.workspace, s.team),
  ] as const

/** The toast (and the change behind it) for an action; an empty message shows none. */
export async function performAction(action: RowAction, ctx: ActionContext): Promise<ToastInput> {
  try {
    return await run(action, ctx)
  } catch (error) {
    // A refusal says why ("Add a reason for rejecting"); a failure of ours says only that it failed.
    const reason = error instanceof HttpError && error.status < 500 ? error.message : undefined
    return {
      message: reason ? `${failedMessage(action)}: ${reason}` : failedMessage(action),
      tone: 'error',
    }
  }
}

function failedMessage(action: RowAction): string {
  switch (action.type) {
    case 'review':
      return `Couldn't ${action.decision === 'approved' ? 'approve' : 'reject'} ${action.subject.label}`
    case 'requestReview':
      return "Couldn't ask for a review"
    case 'assignMe':
      return "Couldn't assign it to you"
    case 'snoozeTriage':
    case 'snoozeNotice':
    case 'snoozeRequest':
      return "Couldn't snooze it"
    case 'dismissTriage':
      return "Couldn't dismiss it"
    case 'read':
    case 'removeNotice':
      return "Couldn't change the notice"
    default:
      return "Couldn't do that"
  }
}

async function run(action: RowAction, ctx: ActionContext): Promise<ToastInput> {
  const { queryClient } = ctx
  switch (action.type) {
    case 'copyLink': {
      const ok = await ctx.copy(new URL(action.path, ctx.origin).href)
      return ok ? { message: 'Link copied' } : { message: "Couldn't copy the link", tone: 'error' }
    }
    case 'newTab':
      ctx.openTab(new URL(action.path, ctx.origin).href)
      return { message: '' }
    case 'review': {
      const { subject, decision, names, reason } = action
      const base = teamPath(subject.workspace, subject.team, 'builds', subject.number)
      const verb = decision === 'approved' ? 'Approved' : 'Rejected'
      const body = reason ? { reason } : {}
      const answer =
        names === undefined
          ? await post<Review.Decided>(`${base}/review`, { state: decision, ...body })
          : await post<Review.Decided>(`${base}/snapshots/review`, {
              snapshotNames: names,
              decision,
              ...body,
            })
      const refresh = () => invalidateAll(queryClient, ...reviewKeys(subject))
      await refresh()
      const what =
        Array.isArray(names) && names.length === 1 ? (names[0] ?? subject.label) : subject.label
      // No token: the decision changed nothing (everything was decided that way already).
      const message = answer.undo ? `${verb} ${what}` : `Nothing to change in ${subject.label}`
      return withUndo(
        message,
        answer.undo,
        subject,
        refresh,
        `Couldn't undo ${verb.toLowerCase()} ${what}`,
      )
    }
    case 'requestReview': {
      const { subject, reviewers } = action
      const buildId = await buildIdOf(queryClient, subject)
      const answer = await post<Review.BulkRequested>(
        teamPath(subject.workspace, subject.team, 'builds', 'request-review'),
        { buildIds: [buildId], reviewerIds: reviewers.map((r) => r.id) },
      )
      const refresh = () =>
        invalidateAll(
          queryClient,
          keys.inbox(),
          keys.reviews(),
          keys.sidebar(),
          keys.build(subject.workspace, subject.team, subject.number),
        )
      await refresh()
      const names = reviewers.map((r) => r.name)
      const who = names.length === 1 ? (names[0] ?? '') : `${names.length} people`
      return withUndo(
        answer.undo ? `Asked ${who} to review ${subject.label}` : `${who} already asked`,
        answer.undo,
        subject,
        refresh,
        "Couldn't cancel the request",
      )
    }
    case 'snoozeRequest': {
      const { subject, choice } = action
      const answer = await post<Review.Snoozed>(
        teamPath(subject.workspace, subject.team, 'review-requests', subject.id, 'snooze'),
        { kind: choice },
      )
      const refresh = () => invalidateAll(queryClient, keys.reviews(), keys.sidebar())
      await refresh()
      return withUndo(UNTIL[choice], answer.undo, subject, refresh)
    }
    case 'assignMe': {
      const { subject } = action
      const me = ctx.me
      if (!me) return { message: "Couldn't assign it to you", tone: 'error' }
      const answer = await post<Triage.ItemState>(
        teamPath(subject.workspace, subject.team, 'triage', 'assign'),
        { kind: subject.kind, key: subject.key, assigneeId: me.id },
      )
      const refresh = () =>
        invalidateAll(queryClient, keys.triage(subject.workspace, subject.team), keys.sidebar())
      await refresh()
      return withUndo('Assigned to you', answer.undo, subject, refresh)
    }
    case 'snoozeTriage': {
      const { subject, choice } = action
      const answer = await post<Triage.ItemState>(
        teamPath(subject.workspace, subject.team, 'triage', 'snooze'),
        { kind: subject.kind, key: subject.key, choice },
      )
      const refresh = () =>
        invalidateAll(queryClient, keys.triage(subject.workspace, subject.team), keys.sidebar())
      await refresh()
      return withUndo(UNTIL[choice], answer.undo, subject, refresh)
    }
    case 'dismissTriage': {
      const { subject } = action
      const answer = await post<Triage.ItemState>(
        teamPath(subject.workspace, subject.team, 'triage', 'dismiss'),
        { kind: subject.kind, key: subject.key },
      )
      const refresh = () =>
        invalidateAll(queryClient, keys.triage(subject.workspace, subject.team), keys.sidebar())
      await refresh()
      return withUndo('Dismissed', answer.undo, subject, refresh)
    }
    case 'read': {
      const { subject, read } = action
      const answer = await post<Undo.Field>(inboxPath(subject.id, 'read'), {
        read,
      })
      const refresh = () => invalidateAll(queryClient, keys.inbox(), keys.sidebar())
      await refresh()
      return withUndo(read ? 'Marked as read' : 'Marked as unread', answer.undo, null, refresh)
    }
    case 'snoozeNotice': {
      const { subject, choice } = action
      const answer = await post<Undo.Field>(inboxPath(subject.id, 'snooze'), {
        choice,
      })
      const refresh = () => invalidateAll(queryClient, keys.inbox(), keys.sidebar())
      await refresh()
      return withUndo(UNTIL[choice], answer.undo, null, refresh)
    }
    default: {
      const { subject } = action
      const answer = await send<Undo.Field>('DELETE', inboxPath(subject.id))
      const refresh = () => invalidateAll(queryClient, keys.inbox(), keys.sidebar())
      await refresh()
      return withUndo('Removed', answer.undo, null, refresh)
    }
  }
}

/** Whether a decision still needs a reason before it can be sent (a rejection with none). */
export const needsReason = (action: RowAction): action is RowAction & { type: 'review' } =>
  action.type === 'review' && action.decision === 'rejected' && !action.reason
