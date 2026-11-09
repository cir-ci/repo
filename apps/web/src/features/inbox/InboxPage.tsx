import type { Inbox } from '@circi/api'
import {
  Badge,
  Button,
  Delayed,
  EmptyState,
  InboxIcon,
  ListRow,
  ListSkeleton,
  Pane,
  Text,
  useAnnounce,
  visuallyHidden,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { useLoadingAnnouncement } from '#features/builds/list/loading.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { focusRow, leavesKeyToFocus, nextAfterRemoval } from '#lib/list-keys.ts'
import { PageHeading } from '#lib/PageHeading.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { useShortcutHandlers } from '#lib/shortcuts.ts'
import type { SnoozeChoice } from '#lib/snooze.ts'
import { SnoozeMenu } from '#lib/SnoozeMenu.tsx'
import { useListStore } from '#lib/stores/list-store.ts'
import { TabList } from '#lib/TabList.tsx'
import { useClientLink } from '#lib/use-client-link.ts'
import { useListNavigation } from '#lib/use-list-navigation.ts'

import {
  INBOX_TABS,
  inboxCount,
  inboxQuery,
  notificationTarget,
  notificationText,
  useMarkAllRead,
  useRemoveNotification,
  useSetRead,
  useSnoozeNotification,
  useUnsnoozeNotification,
} from './api.ts'

import styles from '#lib/ListPage.module.css'

export function InboxPage() {
  useDocumentTitle('Inbox')
  const { tab } = useSearch({ from: '/inbox' })
  const navigate = useNavigate()
  const announce = useAnnounce()
  const clientLink = useClientLink()
  const { data, error, refetch } = useQuery(inboxQuery(tab))
  useLoadingAnnouncement(!data && !error, 'Loading your inbox')

  const selectedId = useListStore((s) => s.cursorId)
  const setSelectedId = useListStore((s) => s.setCursorId)
  const peek = useListStore((s) => s.peek)
  const togglePeek = useListStore((s) => s.togglePeek)
  useEffect(() => () => useListStore.getState().reset(), [])
  const [snoozeOpen, setSnoozeOpen] = useState(false)

  const setRead = useSetRead()
  const snooze = useSnoozeNotification()
  const unsnooze = useUnsnoozeNotification()
  const remove = useRemoveNotification()
  const markAll = useMarkAllRead()

  const items = data?.items ?? []
  const selected = items.find((i) => i.id === selectedId) ?? items[0]
  const snoozedTab = tab === 'snoozed'

  const {
    ref: listElement,
    listRef,
    rowProps,
  } = useListNavigation({
    items,
    getId: (i) => i.id,
    selectedId: selected?.id,
    onSelect: (i) => setSelectedId(i.id),
  })

  const markRead = (item: Inbox.Item) => {
    if (!item.readAt) setRead.mutate({ id: item.id, read: true })
  }
  const open = (item: Inbox.Item) => {
    markRead(item)
    const target = notificationTarget(item)
    if (target) void navigate(target)
  }

  /** Runs `act` for an item that is about to leave this tab, then selects the next one. */
  const settle = (item: Inbox.Item, message: string, act: (done: () => void) => void) => {
    const next = nextAfterRemoval(items, (i) => i.id, item.id)
    act(() => {
      announce(message)
      setSelectedId(next)
      if (next) focusRow(listElement.current, next)
    })
  }

  const toggleRead = (item: Inbox.Item) =>
    setRead.mutate(
      { id: item.id, read: !item.readAt },
      { onSuccess: () => announce(item.readAt ? 'Marked unread' : 'Marked read') },
    )
  const doSnooze = (item: Inbox.Item, choice: SnoozeChoice) =>
    settle(item, 'Snoozed', (done) => snooze.mutate({ id: item.id, choice }, { onSuccess: done }))
  const doUnsnooze = (item: Inbox.Item) =>
    settle(item, 'Brought back', (done) => unsnooze.mutate(item.id, { onSuccess: done }))
  const doRemove = (item: Inbox.Item) =>
    settle(item, 'Deleted', (done) => remove.mutate(item.id, { onSuccess: done }))

  useShortcutHandlers({
    open: (_action, event) => {
      if (leavesKeyToFocus(event) || !selected) return false
      open(selected)
      return undefined
    },
    peek: (_action, event) => {
      if (leavesKeyToFocus(event) || !selected) return false
      togglePeek()
      return undefined
    },
    toggleRead: () => {
      if (selected) toggleRead(selected)
    },
    snooze: () => {
      if (selected && !snoozedTab) setSnoozeOpen(true)
    },
    remove: () => {
      if (selected) doRemove(selected)
    },
  })

  const failed = [setRead, snooze, unsnooze, remove, markAll].find((m) => m.error)?.error
  const unread = data?.unread ?? 0

  return (
    <>
      <PageHeading
        title="Inbox"
        actions={
          <Button
            size="sm"
            disabled={unread === 0}
            loading={markAll.isPending}
            onClick={() =>
              markAll.mutate(undefined, { onSuccess: () => announce('Marked everything read') })
            }
          >
            Mark all read
          </Button>
        }
      />
      <div className={styles.page}>
        <TabList
          label="Inbox"
          tabs={INBOX_TABS}
          value={tab}
          onChange={(next) => {
            setSelectedId(undefined)
            void navigate({ to: '/inbox', search: { tab: next }, replace: true })
          }}
        >
          <div className={styles.body}>
            {error ? (
              <ErrorState error={error} onRetry={() => void refetch()} />
            ) : !data ? (
              <Delayed>
                <ListSkeleton rows={4} />
              </Delayed>
            ) : items.length === 0 ? (
              <EmptyState icon={<InboxIcon size={32} />} title={EMPTY[tab].title}>
                {EMPTY[tab].text}
              </EmptyState>
            ) : (
              <>
                <div className={styles.toolbar}>
                  <span role="status" className={styles.count}>
                    {inboxCount(items)}
                  </span>
                  {selected ? (
                    <Button size="sm" aria-keyshortcuts="u" onClick={() => toggleRead(selected)}>
                      {selected.readAt ? 'Mark unread' : 'Mark read'}
                    </Button>
                  ) : null}
                  {selected && !snoozedTab ? (
                    <SnoozeMenu
                      allowNextPush={false}
                      open={snoozeOpen}
                      onOpenChange={setSnoozeOpen}
                      onSnooze={(choice) => doSnooze(selected, choice)}
                      trigger={
                        <Button size="sm" aria-keyshortcuts="h">
                          Snooze
                        </Button>
                      }
                    />
                  ) : null}
                  {selected && snoozedTab ? (
                    <Button size="sm" onClick={() => doUnsnooze(selected)}>
                      Unsnooze
                    </Button>
                  ) : null}
                  {selected ? (
                    <Button
                      size="sm"
                      variant="danger"
                      aria-keyshortcuts="Backspace"
                      onClick={() => doRemove(selected)}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
                {failed ? (
                  <Text tone="rejected" role="alert">
                    {failed.message}
                  </Text>
                ) : null}
                <div className={styles.split}>
                  <ul
                    aria-label={INBOX_TABS.find((t) => t.value === tab)?.label ?? 'Inbox'}
                    className={styles.list}
                    ref={listRef}
                  >
                    {items.map((item) => {
                      const { title, detail } = notificationText(item)
                      const target = notificationTarget(item)
                      const link = target ? clientLink(target) : undefined
                      return (
                        <li key={item.id} {...rowProps(item.id)}>
                          <ListRow
                            density="two-line"
                            selected={item.id === selected?.id}
                            href={link?.href}
                            onClick={(event) => {
                              setSelectedId(item.id)
                              if (!item.readAt) setRead.mutate({ id: item.id, read: true })
                              link?.onClick(event)
                            }}
                            leading={
                              item.readAt ? (
                                <span className={styles.read} />
                              ) : (
                                <span className={styles.unread} aria-hidden="true" />
                              )
                            }
                            trailing={
                              <span className={styles.trailing}>
                                {item.alsoInReviews ? (
                                  <Badge shape="tag">Also in Reviews</Badge>
                                ) : null}
                                <Text variant="small" tone="secondary">
                                  <RelativeTime iso={item.createdAt} />
                                </Text>
                              </span>
                            }
                          >
                            <span style={item.readAt ? undefined : visuallyHidden}>
                              {item.readAt ? null : 'Unread. '}
                            </span>
                            <Text truncate>{title}</Text>
                            <span className={styles.meta}>
                              {detail ? <span>{detail}</span> : null}
                              {item.team ? <span>{item.team.name}</span> : null}
                            </span>
                          </ListRow>
                        </li>
                      )
                    })}
                  </ul>
                  {peek && selected ? (
                    <Pane
                      label="Preview"
                      context={selected.build ? `#${selected.build.number}` : undefined}
                      actions={<OpenButton item={selected} onOpen={markRead} />}
                    >
                      <ItemDetail item={selected} />
                    </Pane>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </TabList>
      </div>
    </>
  )
}

function OpenButton({ item, onOpen }: { item: Inbox.Item; onOpen: (item: Inbox.Item) => void }) {
  const clientLink = useClientLink()
  const target = notificationTarget(item)
  if (!target) return null
  const link = clientLink(target)
  return (
    <Button
      size="sm"
      variant="primary"
      href={link.href}
      onClick={(event) => {
        onOpen(item)
        link.onClick(event)
      }}
    >
      {item.build ? 'Open build' : 'Open team'}
    </Button>
  )
}

const EMPTY: Record<Inbox.Tab, { title: string; text: string }> = {
  'for-you': {
    title: 'You’re all caught up',
    text: 'Reviews, mentions and decisions for you appear here.',
  },
  everything: { title: 'Nothing here yet', text: 'Every notification you get appears here.' },
  snoozed: {
    title: 'Nothing snoozed',
    text: 'Notifications you put off wait here until they wake.',
  },
}

function ItemDetail({ item }: { item: Inbox.Item }) {
  const { title, detail } = notificationText(item)
  return (
    <div className={styles.detail}>
      <Text>{title}</Text>
      {detail ? <Text tone="secondary">{detail}</Text> : null}
      <dl>
        {item.team ? (
          <>
            <dt>Team</dt>
            <dd>{item.team.name}</dd>
          </>
        ) : null}
        {item.build ? (
          <>
            <dt>Branch</dt>
            <dd>{item.build.branch ?? item.build.commitSha.slice(0, 7)}</dd>
          </>
        ) : null}
        <dt>When</dt>
        <dd>
          <RelativeTime iso={item.createdAt} />
        </dd>
        {item.snoozedUntil ? (
          <>
            <dt>Snoozed until</dt>
            <dd>
              <RelativeTime iso={item.snoozedUntil} />
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  )
}
