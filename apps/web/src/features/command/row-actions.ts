import type { QueryClient } from '@tanstack/react-query'

import { inboxPath, teamPath } from '#lib/api-paths.ts'
import { post, send } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'
import type { ToastInput } from '#lib/stores/undo-store.ts'

import type { RowAction, SnoozeUntil } from './entry.ts'

/**
 * What a row's action does and says. A change to the server (a decision, an assignment, a snooze,
 * a notice read or removed) comes back as a toast with Undo: the change is sent unless Undo is
 * pressed first (see `useUndoStore`). Copying a link and opening a tab are done on the spot.
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

/** The toast (and the change behind it) for an action; an empty message shows none. */
export async function performAction(action: RowAction, ctx: ActionContext): Promise<ToastInput> {
  const { queryClient } = ctx
  switch (action.type) {
    case 'copyLink': {
      const ok = await ctx.copy(new URL(action.path, ctx.origin).href)
      return { message: ok ? 'Link copied' : "Couldn't copy the link" }
    }
    case 'newTab':
      ctx.openTab(new URL(action.path, ctx.origin).href)
      return { message: '' }
    case 'review': {
      const { subject, decision } = action
      const verb = decision === 'approved' ? 'Approved' : 'Rejected'
      return {
        message: `${verb} ${subject.label}`,
        failed: `Couldn't ${decision === 'approved' ? 'approve' : 'reject'} ${subject.label}`,
        commit: async () => {
          await post(
            teamPath(subject.workspace, subject.team, 'builds', subject.number, 'review'),
            { state: decision },
          )
          await invalidateAll(
            queryClient,
            keys.inbox(),
            keys.reviews(),
            keys.sidebar(),
            keys.teams(),
            keys.build(subject.workspace, subject.team, subject.number),
            keys.team(subject.workspace, subject.team),
            keys.triage(subject.workspace, subject.team),
          )
        },
      }
    }
    case 'assignMe': {
      const { subject } = action
      const me = ctx.me
      if (!me) return { message: "Couldn't assign it to you" }
      return {
        message: 'Assigned to you',
        failed: "Couldn't assign it to you",
        commit: async () => {
          await post(teamPath(subject.workspace, subject.team, 'triage', 'assign'), {
            kind: subject.kind,
            key: subject.key,
            assigneeId: me.id,
          })
          await invalidateAll(
            queryClient,
            keys.triage(subject.workspace, subject.team),
            keys.sidebar(),
          )
        },
      }
    }
    case 'snoozeTriage': {
      const { subject, choice } = action
      return {
        message: UNTIL[choice],
        failed: "Couldn't snooze it",
        commit: async () => {
          await post(teamPath(subject.workspace, subject.team, 'triage', 'snooze'), {
            kind: subject.kind,
            key: subject.key,
            choice,
          })
          await invalidateAll(
            queryClient,
            keys.triage(subject.workspace, subject.team),
            keys.sidebar(),
          )
        },
      }
    }
    case 'dismissTriage': {
      const { subject } = action
      return {
        message: 'Dismissed',
        failed: "Couldn't dismiss it",
        commit: async () => {
          await post(teamPath(subject.workspace, subject.team, 'triage', 'dismiss'), {
            kind: subject.kind,
            key: subject.key,
          })
          await invalidateAll(
            queryClient,
            keys.triage(subject.workspace, subject.team),
            keys.sidebar(),
          )
        },
      }
    }
    case 'read': {
      const { subject, read } = action
      return {
        message: read ? 'Marked as read' : 'Marked as unread',
        failed: "Couldn't change the notice",
        commit: async () => {
          await post(inboxPath(subject.id, 'read'), { read })
          await invalidateAll(queryClient, keys.inbox(), keys.sidebar())
        },
      }
    }
    case 'snoozeNotice': {
      const { subject, choice } = action
      return {
        message: UNTIL[choice],
        failed: "Couldn't snooze it",
        commit: async () => {
          await post(inboxPath(subject.id, 'snooze'), { choice })
          await invalidateAll(queryClient, keys.inbox(), keys.sidebar())
        },
      }
    }
    default: {
      const { subject } = action
      return {
        message: 'Removed',
        failed: "Couldn't remove it",
        commit: async () => {
          await send('DELETE', inboxPath(subject.id))
          await invalidateAll(queryClient, keys.inbox(), keys.sidebar())
        },
      }
    }
  }
}
