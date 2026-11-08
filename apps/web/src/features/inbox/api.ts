import type { Inbox, NotificationKind } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, send, seg } from '#lib/http.ts'
import type { SnoozeChoice } from '#lib/snooze.ts'

export const INBOX_TABS: readonly { value: Inbox.Tab; label: string }[] = [
  { value: 'for-you', label: 'For you' },
  { value: 'everything', label: 'Everything' },
  { value: 'snoozed', label: 'Snoozed' },
]

export interface InboxSearch {
  tab: Inbox.Tab
}

/** The `?tab=` of the page: anything unknown is "For you". */
export function validateInboxSearch(search: Record<string, unknown>): InboxSearch {
  const tab = INBOX_TABS.find((t) => t.value === search['tab'])
  return { tab: tab?.value ?? 'for-you' }
}

export const inboxQuery = (tab: Inbox.Tab) =>
  queryOptions({
    queryKey: ['inbox', tab],
    queryFn: () => getJson<Inbox.List>(`/api/inbox?tab=${seg(tab)}`),
  })

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

/** The words of a row: what happened, and (for a rejection or a mention) the detail under it. */
export function notificationText(item: Inbox.Item): { title: string; detail?: string } {
  const who = item.actor?.name ?? 'Someone'
  const build = item.build ? ` build #${item.build.number}` : ' a build'
  const kinds: Record<NotificationKind, { title: string; detail?: string | undefined }> = {
    review_requested: { title: `${who} requested your review of${build}` },
    review_re_requested: { title: `${who} asked you to review${build} again` },
    mentioned: { title: `${who} mentioned you on${build}`, detail: text(item.payload['snippet']) },
    build_approved: { title: `${who} approved${build}` },
    build_rejected: { title: `${who} rejected${build}`, detail: text(item.payload['reason']) },
    review_overdue: { title: `Your review of${build} is overdue` },
    connection_needs_attention: {
      title: `${item.team?.name ?? 'A team'}’s git connection needs attention`,
    },
    flaky_detected: {
      title: `Flaky screenshots found${item.team ? ` in ${item.team.name}` : ''}`,
    },
  }
  const { title, detail } = kinds[item.kind]
  return detail ? { title, detail } : { title }
}

/** A row's screen-reader name: unread state, the text and where. */
export function notificationName(item: Inbox.Item): string {
  const { title } = notificationText(item)
  return [item.readAt ? undefined : 'Unread', title, item.team?.name].filter(Boolean).join(', ')
}

/** "3 unread of 12", "12 notifications", "No notifications": what the list announces. */
export function inboxCount(items: readonly Inbox.Item[]): string {
  const unread = items.filter((i) => !i.readAt).length
  const all = `${items.length} ${items.length === 1 ? 'notification' : 'notifications'}`
  return unread > 0 ? `${all}, ${unread} unread` : all
}

/** Where a notification leads: its build, else its team, else nowhere. */
export function notificationTarget(item: Inbox.Item):
  | {
      to: '/$workspace/$team/builds/$number'
      params: { workspace: string; team: string; number: string }
    }
  | { to: '/$workspace/$team'; params: { workspace: string; team: string } }
  | undefined {
  if (!item.workspace || !item.team) return undefined
  const base = { workspace: item.workspace.slug, team: item.team.slug }
  return item.build
    ? {
        to: '/$workspace/$team/builds/$number',
        params: { ...base, number: String(item.build.number) },
      }
    : { to: '/$workspace/$team', params: base }
}

/** Every list showing the unread count or the same entry: refetched after a change. */
function useRefresh() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all(
      [['inbox'], ['sidebar']].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    )
}

export function useSetRead() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) =>
      post<Inbox.State>(`/api/inbox/${seg(id)}/read`, { read }),
    onSuccess: refresh,
  })
}

export function useSnoozeNotification() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ id, choice }: { id: string; choice: SnoozeChoice }) =>
      post<Inbox.State>(`/api/inbox/${seg(id)}/snooze`, snoozeBody(choice)),
    onSuccess: refresh,
  })
}

/** The inbox's snooze body: a time only (`tomorrow`, `next_week` or a date), never "next push". */
export function snoozeBody(
  choice: SnoozeChoice,
): { choice: 'tomorrow' | 'next_week' } | { choice: 'date'; date: string } {
  if (choice.kind === 'date') return { choice: 'date', date: choice.date }
  // A notification has no push to wait for; the menu doesn't offer it, so this is the next best.
  return { choice: choice.kind === 'next_push' ? 'tomorrow' : choice.kind }
}

export function useUnsnoozeNotification() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (id: string) => post<Inbox.State>(`/api/inbox/${seg(id)}/unsnooze`, {}),
    onSuccess: refresh,
  })
}

export function useRemoveNotification() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (id: string) => send<undefined>('DELETE', `/api/inbox/${seg(id)}`),
    onSuccess: refresh,
  })
}

export function useMarkAllRead() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: () => post<{ marked: number }>('/api/inbox/read-all', {}),
    onSuccess: refresh,
  })
}
