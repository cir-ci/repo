import type { Comment, Triage } from '@circi/api'
import {
  Avatar,
  Badge,
  Button,
  Delayed,
  EmptyState,
  ListRow,
  ListSkeleton,
  Pane,
  StatusIcon,
  Text,
  useAnnounce,
  visuallyHidden,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { fileUrl } from '#features/builds/api/index.ts'
import { useLoadingAnnouncement } from '#features/builds/list/loading.ts'
import { RegionLayer } from '#features/regions/RegionLayer.tsx'
import { authClient } from '#lib/auth-client.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { focusRow, nextAfterRemoval } from '#lib/list-keys.ts'
import { PageHeading, teamCrumb } from '#lib/PageHeading.tsx'
import { useShortcutHandlers } from '#lib/shortcuts.ts'
import type { SnoozeChoice } from '#lib/snooze.ts'
import { SnoozeMenu } from '#lib/SnoozeMenu.tsx'
import { useListStore } from '#lib/stores/list-store.ts'
import { useListNavigation } from '#lib/use-list-navigation.ts'

import {
  flatten,
  type Frame,
  groupItems,
  itemId,
  itemName,
  itemTitle,
  KIND_LABEL,
  queueCount,
  regionToPixels,
  rotationText,
  sinceText,
  triageQuery,
  useAcceptBaseline,
  useAddIgnoreRegion,
  useAssignTriage,
  useDismissTriage,
  useFilmstrip,
  useSnoozeTriage,
} from './api.ts'
import { ROUTE } from './routes.ts'

import listStyles from '#lib/ListPage.module.css'
import styles from './TriagePage.module.css'

/** Accepting a baseline and ignoring a region are about a screenshot; a failed build has none. */
const hasSnapshot = (item: Triage.Item | undefined) => !!item?.snapshotName

export function TriagePage() {
  const { workspace, team } = useParams({ from: ROUTE })
  useDocumentTitle('Triage', team)
  const announce = useAnnounce()
  const { data, error, refetch } = useQuery(triageQuery(workspace, team))
  useLoadingAnnouncement(!data && !error, 'Loading triage')
  const { data: session } = authClient.useSession()
  const me = session?.user

  const selectedId = useListStore((s) => s.cursorId)
  const setSelectedId = useListStore((s) => s.setCursorId)
  useEffect(() => () => useListStore.getState().reset(), [])
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [pending, setPending] = useState<Comment.Region | null>(null)

  const assign = useAssignTriage(workspace, team)
  const snooze = useSnoozeTriage(workspace, team)
  const dismiss = useDismissTriage(workspace, team)
  const accept = useAcceptBaseline(workspace, team)
  const addRegion = useAddIgnoreRegion(workspace, team)

  const groups = groupItems(data?.items ?? [])
  const items = flatten(groups)
  const selected = items.find((i) => itemId(i) === selectedId) ?? items[0]
  const { frames, loading: framesLoading } = useFilmstrip(workspace, team, selected)

  const { listRef, rowProps } = useListNavigation({
    items,
    getId: itemId,
    selectedId: selected ? itemId(selected) : undefined,
    onSelect: (i) => select(i),
  })

  function select(item: Triage.Item) {
    setSelectedId(itemId(item))
    setDrawing(false)
    setPending(null)
  }

  /** Selects the neighbour of an item that is about to leave the queue, and says what happened. */
  const leave = (item: Triage.Item, message: string) => {
    const next = nextAfterRemoval(items, itemId, itemId(item))
    announce(message)
    setSelectedId(next)
    setDrawing(false)
    setPending(null)
    if (next) queueMicrotask(() => focusRow(document.getElementById('triage-groups'), next))
  }

  const doSnooze = (item: Triage.Item, choice: SnoozeChoice) =>
    snooze.mutate({ ref: item, choice }, { onSuccess: () => leave(item, 'Snoozed') })
  const doDismiss = (item: Triage.Item) =>
    dismiss.mutate({ ref: item }, { onSuccess: () => leave(item, 'Dismissed') })
  const doAccept = (item: Triage.Item) => {
    if (!item.snapshotName) return
    accept.mutate(
      { ref: item, buildNumber: item.build.number, snapshotName: item.snapshotName },
      { onSuccess: () => announce(`Accepted ${item.snapshotName} as baseline`) },
    )
  }
  const doAssign = (item: Triage.Item) => {
    if (!me) return
    const mine = item.assignee?.id === me.id
    assign.mutate(
      { ref: item, assignee: mine ? null : { id: me.id, name: me.name } },
      { onSuccess: () => announce(mine ? 'Unassigned' : 'Assigned to you') },
    )
  }
  const startDrawing = () => {
    if (!hasSnapshot(selected)) return
    setPending(null)
    setDrawing(true)
    announce('Drag over the screenshot to mark the region to ignore')
  }
  const confirmRegion = (item: Triage.Item, frame: Frame | undefined) => {
    if (!pending || !item.snapshotName || !frame) return
    const rect = regionToPixels(pending, frame)
    if (!rect) return
    addRegion.mutate(
      { ref: item, name: item.snapshotName, rect },
      { onSuccess: () => leave(item, 'Ignore region added') },
    )
  }

  useShortcutHandlers({
    acceptBaseline: () => {
      if (selected && hasSnapshot(selected)) doAccept(selected)
    },
    ignoreRegion: startDrawing,
    assignMe: () => {
      if (selected) doAssign(selected)
    },
    snooze: () => {
      if (selected) setSnoozeOpen(true)
    },
    dismiss: () => {
      if (selected) doDismiss(selected)
    },
  })

  const failed = [assign, snooze, dismiss, accept, addRegion].find((m) => m.error)?.error
  const chip = data ? rotationText(data.rotation) : undefined

  return (
    <>
      <PageHeading
        crumbs={[teamCrumb(workspace, { slug: team, name: team })]}
        title="Triage"
        actions={
          data && chip && data.rotation.onTriage ? (
            <Badge shape="tag" tone="accent" aria-label={chip}>
              <span className={styles.chip}>
                <Avatar name={data.rotation.onTriage.name} size={16} />
                {chip}
              </span>
            </Badge>
          ) : undefined
        }
      />
      <div className={listStyles['page']}>
        <div className={listStyles['body']}>
          {error ? (
            <ErrorState error={error} onRetry={() => void refetch()} notFound="Team not found" />
          ) : !data ? (
            <Delayed>
              <ListSkeleton rows={4} />
            </Delayed>
          ) : items.length === 0 ? (
            <EmptyState title="Nothing to triage">
              Flaky screenshots, missing baselines and failed builds on the default branch appear
              here.
            </EmptyState>
          ) : (
            <>
              <div className={listStyles['toolbar']}>
                <span role="status" className={listStyles['count']}>
                  {queueCount(groups)}
                </span>
                {selected ? (
                  <>
                    <Button
                      size="sm"
                      aria-keyshortcuts="b"
                      disabled={!hasSnapshot(selected)}
                      loading={accept.isPending}
                      onClick={() => doAccept(selected)}
                    >
                      Accept as baseline
                    </Button>
                    <Button
                      size="sm"
                      aria-keyshortcuts="i"
                      disabled={!hasSnapshot(selected)}
                      onClick={startDrawing}
                    >
                      Add ignore region
                    </Button>
                    <Button
                      size="sm"
                      aria-keyshortcuts="m"
                      disabled={!me}
                      onClick={() => doAssign(selected)}
                    >
                      {selected.assignee && selected.assignee.id === me?.id
                        ? 'Unassign me'
                        : 'Assign to me'}
                    </Button>
                    <SnoozeMenu
                      open={snoozeOpen}
                      onOpenChange={setSnoozeOpen}
                      onSnooze={(choice) => doSnooze(selected, choice)}
                      trigger={
                        <Button size="sm" aria-keyshortcuts="h">
                          Snooze
                        </Button>
                      }
                    />
                    <Button size="sm" aria-keyshortcuts="d" onClick={() => doDismiss(selected)}>
                      Dismiss
                    </Button>
                  </>
                ) : null}
              </div>
              {failed ? (
                <Text tone="rejected" role="alert">
                  {failed.message}
                </Text>
              ) : null}
              <div className={listStyles['split']}>
                <div className={styles.groups} id="triage-groups" ref={listRef}>
                  {groups.map((group) => (
                    <section key={group.kind} aria-labelledby={`triage-${group.kind}`}>
                      <h2 className={styles.groupHeader} id={`triage-${group.kind}`}>
                        {group.label}
                        <Badge aria-label={`${group.items.length} items`}>
                          {group.items.length}
                        </Badge>
                      </h2>
                      <ul
                        aria-label={`${group.label}, ${group.items.length} ${group.items.length === 1 ? 'item' : 'items'}`}
                        className={listStyles['list']}
                      >
                        {group.items.map((item) => (
                          <li key={itemId(item)} {...rowProps(itemId(item))}>
                            <ListRow
                              density="two-line"
                              selected={itemId(item) === (selected ? itemId(selected) : '')}
                              onClick={() => select(item)}
                              leading={
                                <StatusIcon
                                  status={
                                    item.kind === 'flaky'
                                      ? 'flaky'
                                      : item.kind === 'no_baseline'
                                        ? 'added'
                                        : 'rejected'
                                  }
                                  decorative
                                />
                              }
                              trailing={
                                item.assignee ? (
                                  <Avatar name={item.assignee.name} size={20} />
                                ) : undefined
                              }
                            >
                              <span style={visuallyHidden}>{`${itemName(item)}. `}</span>
                              <span className={styles.title} aria-hidden="true">
                                <Text truncate>{itemTitle(item)}</Text>
                              </span>
                              <span className={listStyles['meta']} aria-hidden="true">
                                <span>Build #{item.build.number}</span>
                                {item.build.branch ? <span>{item.build.branch}</span> : null}
                                <span>
                                  <Since iso={item.build.createdAt} />
                                </span>
                              </span>
                            </ListRow>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
                {selected ? (
                  <Pane
                    label="Details"
                    context={selected.snapshotName ?? `Build #${selected.build.number}`}
                    width="lg"
                  >
                    <div className={styles.paneBody}>
                      <Text>
                        {KIND_LABEL[selected.kind]} in build #{selected.build.number}
                        {selected.build.branch ? ` on ${selected.build.branch}` : ''}
                      </Text>
                      <Text variant="small" tone="secondary">
                        <Since iso={selected.build.createdAt} />
                        {selected.assignee ? `. Assigned to ${selected.assignee.name}` : ''}
                      </Text>
                      {selected.snapshotName ? (
                        <Filmstrip
                          name={selected.snapshotName}
                          frames={frames}
                          loading={framesLoading}
                        />
                      ) : null}
                      {drawing && selected.snapshotName ? (
                        <Drawing
                          name={selected.snapshotName}
                          frame={frames.find((f) => f.number === selected.build.number)}
                          pending={pending}
                          onDraw={setPending}
                          onCancel={() => {
                            setDrawing(false)
                            setPending(null)
                          }}
                          busy={addRegion.isPending}
                          onConfirm={() =>
                            confirmRegion(
                              selected,
                              frames.find((f) => f.number === selected.build.number),
                            )
                          }
                        />
                      ) : null}
                    </div>
                  </Pane>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

/** "Waiting 3 days", refreshed every minute. */
function Since({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return <>{sinceText(iso, now)}</>
}

function Filmstrip({
  name,
  frames,
  loading,
}: {
  name: string
  frames: readonly Frame[]
  loading: boolean
}) {
  if (frames.length === 0) {
    return loading ? (
      <Text variant="small" tone="secondary">
        Loading recent builds
      </Text>
    ) : null
  }
  return (
    <ol aria-label={`Recent builds of ${name}`} className={styles.filmstrip}>
      {frames.map((frame) => (
        <li key={frame.number} className={styles.frame}>
          <span className={styles.thumb}>{frame.src ? <img src={frame.src} alt="" /> : null}</span>
          <span className={styles.frameMeta}>
            <StatusIcon status={frame.status} label={frame.label} size={12} />#{frame.number}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Drawing({
  name,
  frame,
  pending,
  busy,
  onDraw,
  onCancel,
  onConfirm,
}: {
  name: string
  frame: Frame | undefined
  pending: Comment.Region | null
  busy: boolean
  onDraw: (region: Comment.Region) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!frame?.sha256) {
    return (
      <Text variant="small" tone="secondary">
        This build has no image of {name} to draw on.
      </Text>
    )
  }
  return (
    <div className={styles.paneBody}>
      <Text variant="small" tone="secondary">
        Drag over the screenshot to mark the region CirCI should ignore, or use the arrow keys
        (Shift to resize, Enter to set, Escape to cancel).
      </Text>
      <div className={styles.canvas}>
        <img src={fileUrl(frame.sha256)} alt={`${name} in build #${frame.number}`} />
        <RegionLayer
          annotations={{
            threads: [],
            pending,
            focusedId: null,
            drawing: true,
            // Escape in the keyboard tool cancels, like the Cancel button.
            onDrawingChange: (on) => {
              if (!on) onCancel()
            },
            onDraw,
            onMarker: () => {},
          }}
        />
      </div>
      <div className={styles.drawActions}>
        <Button size="sm" variant="primary" disabled={!pending} loading={busy} onClick={onConfirm}>
          Ignore this region
        </Button>
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
