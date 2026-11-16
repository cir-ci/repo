import type { Inbox } from '@circi/api'

const unreadIn = (items: readonly Inbox.Item[]) => items.filter((i) => i.readAt === null).length

/** The list with these items gone; the unread badge drops by the unread ones among them. */
function without(list: Inbox.List, gone: (item: Inbox.Item) => boolean): Inbox.List {
  const items = list.items.filter((i) => !gone(i))
  const unread = Math.max(0, list.unread - (unreadIn(list.items) - unreadIn(items)))
  return { ...list, items, unread }
}

/** One notification marked read or unread: its row changes and the unread count follows. */
export function withRead(list: Inbox.List, id: string, read: boolean, now: Date): Inbox.List {
  const item = list.items.find((i) => i.id === id)
  if (!item || (item.readAt !== null) === read) return list
  return {
    ...list,
    unread: Math.max(0, list.unread + (read ? -1 : 1)),
    items: list.items.map((i) =>
      i.id === id ? { ...i, readAt: read ? now.toISOString() : null } : i,
    ),
  }
}

/** Every notification in the list read. */
export function withAllRead(list: Inbox.List, now: Date): Inbox.List {
  return {
    ...list,
    unread: 0,
    items: list.items.map((i) => (i.readAt === null ? { ...i, readAt: now.toISOString() } : i)),
  }
}

/** A notification removed from the list (removed, or snoozed out of a tab that doesn't show snoozed ones). */
export const withoutNotification = (list: Inbox.List, id: string): Inbox.List =>
  without(list, (i) => i.id === id)

/** A notification put off: it leaves every tab but Snoozed (which fills in when the server answers). */
export const withSnoozedNotification = (list: Inbox.List, id: string): Inbox.List =>
  list.tab === 'snoozed' ? list : withoutNotification(list, id)

/** A notification brought back: it leaves the Snoozed tab. */
export const withUnsnoozedNotification = (list: Inbox.List, id: string): Inbox.List =>
  list.tab === 'snoozed' ? withoutNotification(list, id) : list

/** The notifications about this build as decided by you: no longer waiting for your review. */
export function withBuildApproved(
  list: Inbox.List,
  build: { workspace: string; project: string; number: number },
): Inbox.List {
  const about = (i: Inbox.Item) =>
    i.build?.number === build.number &&
    i.project?.slug === build.project &&
    i.workspace?.slug === build.workspace
  return {
    ...list,
    items: list.items.map((i) =>
      about(i) && i.build
        ? { ...i, request: null, build: { ...i.build, reviewStatus: 'approved' } }
        : i,
    ),
  }
}
