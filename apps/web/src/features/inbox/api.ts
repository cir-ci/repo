import type { Comment, Inbox, NotificationKind, Review } from '@circi/api'
import type { Status } from '@circi/ui'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { inboxPath, projectPath } from '#lib/api-paths.ts'
import { findParam } from '#lib/find.ts'
import { getJson, post, send, seg } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'
import type { SnoozeChoice } from '#lib/snooze.ts'

export const INBOX_TABS: readonly { value: Inbox.Tab; label: string }[] = [
  { value: 'for-you', label: 'For you' },
  { value: 'everything', label: 'Everything' },
  { value: 'snoozed', label: 'Snoozed' },
]

export interface InboxSearch {
  tab: Inbox.Tab
  /** The find text. */
  q?: string
  /** The notification to select (from a search result). */
  item?: string
}

/** The `?tab=` of the page (anything unknown is "For you"), the find text `?q=` and the `?item=` selected. */
export function validateInboxSearch(search: Record<string, unknown>): InboxSearch {
  const tab = INBOX_TABS.find((t) => t.value === search['tab'])
  const q = findParam(search['q']).trim()
  const item = search['item']
  return {
    tab: tab?.value ?? 'for-you',
    ...(q ? { q } : {}),
    ...(typeof item === 'string' && item ? { item } : {}),
  }
}

/** What a find text is looked for in: the words of the row, the build, its branch, the project and who did it. */
export const inboxFields = (item: Inbox.Item) => {
  const { title, detail } = notificationText(item)
  return [
    title,
    detail,
    item.actor?.name,
    item.project?.name,
    item.build ? `Build #${item.build.number} #${item.build.number}` : undefined,
    item.build?.name === 'default' ? undefined : item.build?.name,
    item.build?.branch,
    item.build?.commitSha,
  ]
}

/** The tabs with the Snoozed count beside its name ("Snoozed 3"); nothing while nothing is snoozed. */
export function inboxTabs(snoozed: number): readonly { value: Inbox.Tab; label: string }[] {
  return INBOX_TABS.map((t) =>
    t.value === 'snoozed' && snoozed > 0 ? { value: t.value, label: `${t.label} ${snoozed}` } : t,
  )
}

export const inboxQuery = (tab: Inbox.Tab) =>
  queryOptions({
    queryKey: keys.inbox(tab),
    queryFn: () => getJson<Inbox.List>(`/api/inbox?tab=${seg(tab)}`),
  })

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

/** "Checkout and 2 more" / "Build #12": what a triage assignment notice is about. */
function triageAssignedDetail(payload: Record<string, unknown>): string | undefined {
  const label = text(payload['label'])
  const count = typeof payload['count'] === 'number' ? payload['count'] : 1
  if (!label) return undefined
  return count > 1 ? `${label} and ${count - 1} more` : label
}

/** What the words of a notification need: an inbox row has all of it, and so has a search result. */
export interface NotificationWords {
  kind: NotificationKind
  actor: { name: string } | null
  build: { number: number } | null
  project: { name: string } | null
  payload: Record<string, unknown>
}

/** The words of a row: what happened, and (for a rejection or a mention) the detail under it. */
export function notificationText(item: NotificationWords): { title: string; detail?: string } {
  const who = item.actor?.name ?? 'Someone'
  const build = item.build ? ` build #${item.build.number}` : ' a build'
  const kinds: Record<NotificationKind, { title: string; detail?: string | undefined }> = {
    review_requested: { title: `${who} requested your review of${build}` },
    review_re_requested: { title: `${who} asked you to review${build} again` },
    mentioned: { title: `${who} mentioned you on${build}`, detail: text(item.payload['snippet']) },
    build_approved: { title: `${who} approved${build}` },
    build_rejected: { title: `${who} rejected${build}`, detail: text(item.payload['reason']) },
    review_overdue: {
      title:
        item.payload['cc'] === true
          ? `${who}'s review of${build} is overdue`
          : `Your review of${build} is overdue`,
    },
    connection_needs_attention: {
      title: `${item.project?.name ?? 'A project'}'s git connection needs attention`,
    },
    flaky_detected: {
      title: `Flaky screenshots found${item.project ? ` in ${item.project.name}` : ''}`,
    },
    triage_assigned: {
      title: 'Assigned to you as the person on triage',
      detail: triageAssignedDetail(item.payload),
    },
  }
  const { title, detail } = kinds[item.kind]
  return detail ? { title, detail } : { title }
}

/** A row's screen-reader name: unread state, the text and where. */
export function notificationName(item: Inbox.Item): string {
  const { title } = notificationText(item)
  return [item.readAt ? undefined : 'Unread', title, item.project?.name].filter(Boolean).join(', ')
}

/** "3 unread of 12", "12 notifications", "No notifications": what the list announces. */
export function inboxCount(items: readonly Inbox.Item[]): string {
  const unread = items.filter((i) => !i.readAt).length
  const all = `${items.length} ${items.length === 1 ? 'notification' : 'notifications'}`
  return unread > 0 ? `${all}, ${unread} unread` : all
}

/**
 * Where a notification leads: its build, else its project, else nowhere. A mention goes to the
 * build's Comments tab at the comment (the page picks its snapshot, if it is pinned to one).
 */
export function notificationTarget(item: Inbox.Item):
  | {
      to: '/$workspace/$project/builds/$number'
      params: { workspace: string; project: string; number: string }
      search?: { sidebar: 'comments'; comment: string }
    }
  | { to: '/$workspace/$project'; params: { workspace: string; project: string } }
  | undefined {
  if (!item.workspace || !item.project) return undefined
  const base = { workspace: item.workspace.slug, project: item.project.slug }
  if (!item.build) return { to: '/$workspace/$project', params: base }
  const target = {
    to: '/$workspace/$project/builds/$number' as const,
    params: { ...base, number: String(item.build.number) },
  }
  const comment = item.kind === 'mentioned' ? text(item.payload['commentId']) : undefined
  return comment ? { ...target, search: { sidebar: 'comments' as const, comment } } : target
}

/** Every list showing the unread count or the same entry: refetched after a change. */
function useRefresh() {
  const queryClient = useQueryClient()
  return () => invalidateAll(queryClient, keys.inbox(), keys.sidebar())
}

export function useSetRead() {
  const refresh = useRefresh()
  return useMutation({
    meta: { what: 'change the notice' },
    mutationFn: ({ id, read }: { id: string; read: boolean }) =>
      post<Inbox.State>(inboxPath(id, 'read'), { read }),
    onSuccess: refresh,
  })
}

export function useSnoozeNotification() {
  const refresh = useRefresh()
  return useMutation({
    meta: { what: 'snooze the notice' },
    mutationFn: ({ id, choice }: { id: string; choice: SnoozeChoice }) =>
      post<Inbox.State>(inboxPath(id, 'snooze'), snoozeBody(choice)),
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
    meta: { what: 'unsnooze the notice' },
    mutationFn: (id: string) => post<Inbox.State>(inboxPath(id, 'unsnooze'), {}),
    onSuccess: refresh,
  })
}

export function useRemoveNotification() {
  const refresh = useRefresh()
  return useMutation({
    meta: { what: 'remove the notice' },
    mutationFn: (id: string) => send<Inbox.Removed>('DELETE', inboxPath(id)),
    onSuccess: refresh,
  })
}

export function useMarkAllRead() {
  const refresh = useRefresh()
  return useMutation({
    meta: { what: 'mark everything read' },
    mutationFn: () => post<{ marked: number }>('/api/inbox/read-all', {}),
    onSuccess: refresh,
  })
}

/** The glyph on a row's avatar, for what the notification is about; none for a mention. */
export function notificationGlyph(kind: NotificationKind): Status | undefined {
  const glyphs: Partial<Record<NotificationKind, Status>> = {
    review_requested: 'needs-review',
    review_re_requested: 'needs-review',
    review_overdue: 'needs-review',
    build_approved: 'approved',
    build_rejected: 'rejected',
    flaky_detected: 'flaky',
  }
  return glyphs[kind]
}

/** What the Open button says: the review, the thread, the build, or (without a build) the project. */
export function openLabel(item: Inbox.Item): string {
  if (item.kind === 'mentioned') return 'Open thread'
  if (item.kind === 'connection_needs_attention') return 'Open project'
  if (item.kind === 'review_requested' || item.kind === 'review_re_requested') return 'Open review'
  if (item.kind === 'review_overdue') return 'Open review'
  return item.build ? 'Open build' : 'Open project'
}

/** The sentence after the title in the pane for notices that say something beyond who did what. */
export function systemText(item: Inbox.Item): string | undefined {
  if (item.kind === 'connection_needs_attention') {
    return "Pull requests may no longer wait for visual review until it's reconnected."
  }
  if (item.kind === 'flaky_detected') {
    return 'They change with no code change. Triage them so they stop blocking reviews.'
  }
  return undefined
}

/** The words someone left with the notification: a rejection's reason or the mention's text. */
export function notificationNote(item: Inbox.Item): string | undefined {
  return notificationText(item).detail
}

/** Whether the build still waits for your review, so the pane can approve it: "Approve all". */
export function awaitsYourReview(item: Inbox.Item): boolean {
  return (
    item.request !== null &&
    item.build !== null &&
    item.build.status === 'complete' &&
    item.build.reviewStatus === 'pending'
  )
}

/** The comment a mention is about, when it can be replied to. */
export function replyTarget(item: Inbox.Item): string | undefined {
  return item.kind === 'mentioned' ? text(item.payload['commentId']) : undefined
}

/** Approves the build a notification is about; every list that shows the same facts is refetched. */
export function useApproveBuild() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'approve the build' },
    mutationFn: (item: Inbox.Item) => {
      if (!item.workspace || !item.project || !item.build) throw new Error('Build not found')
      return post<Review.Decided>(
        projectPath(item.workspace.slug, item.project.slug, 'builds', item.build.number, 'review'),
        { state: 'approved' },
      )
    },
    onSuccess: () =>
      invalidateAll(queryClient, keys.inbox(), keys.reviews(), keys.sidebar(), keys.projects()),
  })
}

/** Replies to the comment a mention is about, in its thread. */
export function useReplyToMention() {
  return useMutation({
    meta: { what: 'send the reply' },
    mutationFn: ({ item, body }: { item: Inbox.Item; body: string }) => {
      const parentId = replyTarget(item)
      if (!item.workspace || !item.project || !item.build || !parentId) {
        throw new Error('Comment not found')
      }
      const input: Comment.Create = { body, parentId }
      return post<{ id: string }>(
        projectPath(
          item.workspace.slug,
          item.project.slug,
          'builds',
          item.build.number,
          'comments',
        ),
        input,
      )
    },
  })
}
