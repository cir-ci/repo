import type { Inbox } from '@circi/api'
import {
  AlarmClockIcon,
  Avatar,
  Badge,
  Button,
  EmptyState,
  InboxIcon,
  ListRow,
  NoResults,
  StatusIcon,
  Text,
  useAnnounce,
  visuallyHidden,
  TabList,
  BellIcon,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { type ReactNode, useState } from 'react'

import { useDocumentTitle } from '#lib/document-title.ts'
import { findIn, useFindParam } from '#lib/find.ts'
import { FindField } from '#lib/FindField.tsx'
import { PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { useShortcutHandlers } from '#lib/shortcuts.ts'
import type { SnoozeChoice } from '#lib/snooze.ts'
import { useSelectFromParam } from '#lib/use-select-from-param.ts'
import { useSelectableList } from '#lib/use-selectable-list.ts'

import {
  awaitsYourReview,
  inboxCount,
  inboxFields,
  inboxQuery,
  inboxTabs,
  notificationGlyph,
  notificationTarget,
  notificationText,
  useApproveBuild,
  useMarkAllRead,
  useRemoveNotification,
  useSetRead,
  useSnoozeNotification,
  useUnsnoozeNotification,
} from './api.ts'
import { EmptyPane, InboxPane } from './InboxPane.tsx'

import styles from './InboxPage.module.css'

export function InboxPage() {
  useDocumentTitle('Inbox')
  const { tab } = useSearch({ from: '/inbox' })
  const navigate = useNavigate()
  const announce = useAnnounce()
  const query = useQuery(inboxQuery(tab))
  // The Snoozed tab's count shows beside its name on every tab.
  const snoozedQuery = useQuery({ ...inboxQuery('snoozed'), enabled: tab !== 'snoozed' })
  const { data } = query
  const snoozedCount = (tab === 'snoozed' ? data : snoozedQuery.data)?.items.length ?? 0

  const [snoozeOpen, setSnoozeOpen] = useState(false)

  const setRead = useSetRead()
  const snooze = useSnoozeNotification()
  const unsnooze = useUnsnoozeNotification()
  const remove = useRemoveNotification()
  const markAll = useMarkAllRead()
  const approve = useApproveBuild()

  const [find, setFind] = useFindParam()
  const everything = data?.items ?? []
  const items = findIn(everything, find, inboxFields)
  const snoozedTab = tab === 'snoozed'

  const markRead = (item: Inbox.Item) => {
    if (!item.readAt) setRead.mutate({ id: item.id, read: true })
  }
  const open = (item: Inbox.Item) => {
    markRead(item)
    const target = notificationTarget(item)
    if (target) void navigate(target)
  }

  const { selected, setSelectedId, listRef, rowProps, settle } = useSelectableList({
    items,
    getId: (i) => i.id,
    onOpen: open,
    peekable: false,
  })

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
  const doApprove = (item: Inbox.Item) =>
    settle(item, 'Approved', (done) => approve.mutate(item, { onSuccess: done }))

  useShortcutHandlers({
    toggleRead: () => {
      if (selected) toggleRead(selected)
    },
    snooze: () => {
      if (selected && !snoozedTab) setSnoozeOpen(true)
    },
    remove: () => {
      if (selected) doRemove(selected)
    },
    approveAll: (_, event) => {
      if (event.repeat || !selected || !awaitsYourReview(selected)) return false
      doApprove(selected)
      return undefined
    },
  })

  useSelectFromParam(setSelectedId)
  const failed = [setRead, snooze, unsnooze, remove, markAll, approve].find((m) => m.error)?.error
  const unread = data?.unread ?? 0

  return (
    <>
      <PageHeading
        title="Inbox"
        actions={
          <>
            <FindField noun="notifications" value={find} onChange={setFind} />
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
          </>
        }
      />
      <div className={styles.page}>
        <TabList
          label="Inbox"
          tabs={inboxTabs(snoozedCount)}
          value={tab}
          onChange={(next) => {
            setSelectedId(undefined)
            void navigate({
              to: '/inbox',
              search: { tab: next, ...(find.trim() ? { q: find.trim() } : {}) },
              replace: true,
            })
          }}
        >
          <QueryBoundary query={query} announce="Loading your inbox" rows={4}>
            {() => (
              <div className={styles.split}>
                <div className={styles.listColumn}>
                  {everything.length > 0 && items.length === 0 ? (
                    <NoResults noun="notification" query={find} onClear={() => setFind('')} />
                  ) : items.length === 0 ? (
                    <EmptyState
                      icon={EMPTY[tab].icon}
                      tone={tab === 'for-you' ? 'success' : 'neutral'}
                      size={tab === 'for-you' ? 'page' : 'section'}
                      title={EMPTY[tab].title}
                    >
                      {EMPTY[tab].text}
                    </EmptyState>
                  ) : (
                    <>
                      <span role="status" className={styles.count}>
                        {inboxCount(items)}
                      </span>
                      {failed ? (
                        <Text tone="failed" role="alert">
                          {failed.message}
                        </Text>
                      ) : null}
                      <ul
                        aria-label={inboxTabs(0).find((t) => t.value === tab)?.label ?? 'Inbox'}
                        className={styles.list}
                        ref={listRef}
                      >
                        {items.map((item) => (
                          <li
                            key={item.id}
                            {...rowProps(item.id)}
                            // Enter on a row opens it (a click only selects).
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter' || event.repeat) return
                              event.preventDefault()
                              open(item)
                            }}
                          >
                            <Row
                              item={item}
                              selected={item.id === selected?.id}
                              onSelect={() => {
                                setSelectedId(item.id)
                                markRead(item)
                              }}
                            />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
                <div className={styles.paneColumn}>
                  {selected ? (
                    <InboxPane
                      item={selected}
                      snoozedTab={snoozedTab}
                      snoozeOpen={snoozeOpen}
                      onSnoozeOpenChange={setSnoozeOpen}
                      onToggleRead={toggleRead}
                      onRemove={doRemove}
                      onSnooze={doSnooze}
                      onUnsnooze={doUnsnooze}
                      onOpen={markRead}
                      onApprove={doApprove}
                      approving={approve.isPending}
                    />
                  ) : items.length > 0 ? (
                    <EmptyPane />
                  ) : null}
                </div>
              </div>
            )}
          </QueryBoundary>
        </TabList>
      </div>
    </>
  )
}

const EMPTY: Record<Inbox.Tab, { icon?: ReactNode; title: string; text: string }> = {
  'for-you': {
    title: "You're all caught up",
    text: 'Reviews, mentions and decisions for you appear here.',
  },
  everything: {
    icon: <InboxIcon />,
    title: 'Nothing here yet',
    text: 'Every notification you get appears here.',
  },
  snoozed: {
    icon: <AlarmClockIcon />,
    title: 'Nothing snoozed',
    text: 'Notifications you put off wait here until they wake.',
  },
}

/** One notification: unread dot, the actor's avatar (or the system's) with the kind's glyph, the words. */
function Row({
  item,
  selected,
  onSelect,
}: {
  item: Inbox.Item
  selected: boolean
  onSelect: () => void
}) {
  const { title, detail } = notificationText(item)
  const glyph = notificationGlyph(item.kind)
  return (
    <ListRow
      density="two-line"
      selected={selected}
      onClick={onSelect}
      leading={
        item.readAt ? (
          <span className={styles.read} />
        ) : (
          <span className={styles.unread} aria-hidden="true" />
        )
      }
      trailing={
        <span className={styles.trailing}>
          {item.alsoInReviews ? <Badge shape="tag">Also in Reviews</Badge> : null}
          <Text variant="small" tone="secondary">
            <RelativeTime iso={item.createdAt} />
          </Text>
        </span>
      }
    >
      <span className={styles.rowBody}>
        <span className={styles.who}>
          {item.actor ? (
            <Avatar type="user" {...item.actor} size={28} />
          ) : (
            <span className={styles.system} aria-hidden="true">
              <BellIcon size={16} />
            </span>
          )}
          {glyph ? (
            <span className={styles.event} aria-hidden="true">
              <StatusIcon status={glyph} size={12} decorative />
            </span>
          ) : null}
        </span>
        <span className={styles.rowText}>
          <span className={styles.rowTitle} {...(item.readAt ? {} : { 'data-unread': '' })}>
            {item.readAt ? null : <span style={visuallyHidden}>Unread. </span>}
            <span>{title}</span>
          </span>
          <span className={styles.rowMeta}>
            {detail ? <span>{detail}</span> : null}
            {item.team ? <span>{item.team.name}</span> : null}
          </span>
        </span>
      </span>
    </ListRow>
  )
}
