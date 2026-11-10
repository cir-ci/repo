import type { Inbox, Undo } from '@circi/api'
import {
  AlarmClockIcon,
  Avatar,
  Badge,
  Button,
  ContextMenu,
  EmptyState,
  InboxIcon,
  ListRow,
  NoResults,
  StatusIcon,
  Text,
  visuallyHidden,
  TabList,
  BellIcon,
} from '@circi/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { type ReactNode, useState } from 'react'

import { InstallBanner } from '#features/pwa/InstallBanner.tsx'
import { DetailSheet } from '#lib/DetailSheet.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { findIn, useFindParam } from '#lib/find.ts'
import { FindField } from '#lib/FindField.tsx'
import { PageHeading } from '#lib/PageHeading.tsx'
import { PaneHandle, paneVars } from '#lib/PaneHandle.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import {
  copyLinkItem,
  menuEntries,
  openInNewTabItem,
  separator,
  snoozeItems,
} from '#lib/row-menu.ts'
import { useShortcutHandlers } from '#lib/shortcuts.ts'
import type { SnoozeChoice } from '#lib/snooze.ts'
import { usePaneWidth } from '#lib/stores/pane-store.ts'
import { toast } from '#lib/toast.ts'
import { refreshAll, type UndoScope, withUndo } from '#lib/undo.ts'
import { usePhone } from '#lib/use-phone.ts'
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
import { InboxPane } from './InboxPane.tsx'

import styles from './InboxPage.module.css'

export function InboxPage() {
  const paneWidth = usePaneWidth('inbox-pane')
  useDocumentTitle('Inbox')
  const { tab } = useSearch({ from: '/inbox' })
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const query = useQuery(inboxQuery(tab))
  // The Snoozed tab's count shows beside its name on every tab.
  const snoozedQuery = useQuery({ ...inboxQuery('snoozed'), enabled: tab !== 'snoozed' })
  const { data } = query
  const snoozedCount = (tab === 'snoozed' ? data : snoozedQuery.data)?.items.length ?? 0

  const [snoozeOpen, setSnoozeOpen] = useState(false)
  // On a phone the selected notification opens as a sheet over the list: the one tapped (it closes
  // itself when that row leaves the list and another is selected).
  const phone = usePhone()
  const [sheetFor, setSheetFor] = useState<string | undefined>(undefined)

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

  // Each change acts at once and its toast offers Undo (the server takes it back).
  const undoable = (message: string, undo: Undo.Token | null, scope: UndoScope = null) =>
    withUndo(message, undo, scope, refreshAll(queryClient))

  const toggleRead = (item: Inbox.Item) =>
    setRead.mutate(
      { id: item.id, read: !item.readAt },
      {
        onSuccess: (answer) =>
          toast.show(undoable(item.readAt ? 'Marked as unread' : 'Marked as read', answer.undo)),
      },
    )
  const doSnooze = (item: Inbox.Item, choice: SnoozeChoice) =>
    settle(item, (done) =>
      snooze.mutate(
        { id: item.id, choice },
        { onSuccess: (answer) => done(undoable('Snoozed', answer.undo)) },
      ),
    )
  // Bringing it back has no Undo: the server doesn't keep what the snooze was.
  const doUnsnooze = (item: Inbox.Item) =>
    settle(item, (done) =>
      unsnooze.mutate(item.id, { onSuccess: () => done({ message: 'Brought back' }) }),
    )
  const doRemove = (item: Inbox.Item) =>
    settle(item, (done) =>
      remove.mutate(item.id, { onSuccess: (answer) => done(undoable('Removed', answer.undo)) }),
    )
  const doApprove = (item: Inbox.Item) =>
    settle(item, (done) =>
      approve.mutate(item, {
        onSuccess: (answer) =>
          done(
            undoable(
              `Approved build #${item.build?.number ?? ''}`.trim(),
              answer.undo,
              item.workspace && item.team
                ? { workspace: item.workspace.slug, team: item.team.slug }
                : null,
            ),
          ),
      }),
    )

  /** A row's right-click menu: what the pane's buttons and keys do, for that notification. */
  const rowMenu = (item: Inbox.Item) => {
    const target = notificationTarget(item)
    const href = target ? router.buildLocation(target).href : undefined
    return menuEntries([
      target && { label: 'Open', onSelect: () => open(item) },
      href !== undefined && openInNewTabItem(href),
      href !== undefined && copyLinkItem(href),
      { label: item.readAt ? 'Mark unread' : 'Mark read', onSelect: () => toggleRead(item) },
      separator,
      ...(snoozedTab
        ? [{ label: 'Unsnooze', onSelect: () => doUnsnooze(item) }]
        : snoozeItems(false, (choice) => doSnooze(item, choice))),
      awaitsYourReview(item) && { label: 'Approve all', onSelect: () => doApprove(item) },
      separator,
      { label: 'Delete', tone: 'danger', onSelect: () => doRemove(item) },
    ])
  }

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
  const pane = (bare: boolean) =>
    selected ? (
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
        bare={bare}
      />
    ) : null
  const failed = [setRead, snooze, unsnooze, remove, markAll, approve].find((m) => m.error)?.error
  const unread = data?.unread ?? 0

  return (
    <>
      <PageHeading
        title="Inbox"
        find={<FindField noun="notifications" value={find} onChange={setFind} />}
        actions={
          <>
            <Button
              size="sm"
              disabled={unread === 0}
              loading={markAll.isPending}
              onClick={() =>
                // No Undo: the server doesn't keep which ones were unread.
                markAll.mutate(undefined, {
                  onSuccess: ({ marked }) =>
                    toast(
                      `Marked ${marked} ${marked === 1 ? 'notification' : 'notifications'} read`,
                    ),
                })
              }
            >
              Mark all read
            </Button>
          </>
        }
      />
      <div className={styles.page}>
        <InstallBanner />
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
              <div
                className={styles.split}
                style={paneVars({ '--circi-pane-width': ['inbox-pane', paneWidth] })}
              >
                <div className={styles.listColumn}>
                  {everything.length > 0 && items.length === 0 ? (
                    <NoResults noun="notification" query={find} onClear={() => setFind('')} />
                  ) : items.length === 0 ? (
                    <EmptyState
                      icon={EMPTY[tab].icon}
                      tone={tab === 'for-you' ? 'success' : 'neutral'}
                      size="page"
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
                            <ContextMenu items={rowMenu(item)}>
                              <Row
                                item={item}
                                selected={item.id === selected?.id}
                                onSelect={() => {
                                  setSelectedId(item.id)
                                  setSheetFor(item.id)
                                  markRead(item)
                                }}
                              />
                            </ContextMenu>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
                {/* The pane only while something is selected: otherwise the list has the width. A phone
                    has no room beside the list: the pane is a sheet over it. */}
                {selected && !phone ? (
                  <>
                    <PaneHandle
                      pane="inbox-pane"
                      edge="start"
                      cssVar="--circi-pane-width"
                      at="calc(100% - var(--circi-pane-width) - 8px)"
                    />
                    <div className={styles.paneColumn}>{pane(false)}</div>
                  </>
                ) : null}
                {phone ? (
                  <DetailSheet
                    open={selected !== undefined && sheetFor === selected.id}
                    onClose={() => setSheetFor(undefined)}
                    label="Notification"
                  >
                    {selected ? pane(true) : null}
                  </DetailSheet>
                ) : null}
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
        <span className={styles.lead}>
          {item.readAt ? (
            <span className={styles.read} />
          ) : (
            <span className={styles.unread} aria-hidden="true" />
          )}
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
        </span>
      }
      trailing={
        <span className={styles.trailing}>
          {item.alsoInReviews ? <Badge shape="tag">Also in Reviews</Badge> : null}
          <Text variant="small" tone="secondary">
            <RelativeTime iso={item.createdAt} />
          </Text>
        </span>
      }
      title={
        <span {...(item.readAt ? { 'data-read': '' } : {})} className={styles.rowTitle}>
          {item.readAt ? null : <span style={visuallyHidden}>Unread. </span>}
          <span>{title}</span>
        </span>
      }
      subtitle={
        <span className={styles.rowMeta}>
          {detail ? <span>{detail}</span> : null}
          {item.team ? <span>{item.team.name}</span> : null}
        </span>
      }
    />
  )
}
