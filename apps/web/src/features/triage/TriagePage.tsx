import type { Triage } from '@circi/api'
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ListRow,
  Pane,
  StatusIcon,
  Text,
  useAnnounce,
  visuallyHidden,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { type NavigateOptions, useNavigate, useParams } from '@tanstack/react-router'
import { type MouseEventHandler, useEffect, useState } from 'react'

import { fileUrl } from '#features/builds/api/index.ts'
import { useCrumbNames } from '#features/teams/crumb-names.ts'
import { authClient } from '#lib/auth-client.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { focusRow, leavesKeyToFocus, nextAfterRemoval } from '#lib/list-keys.ts'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { useShortcutHandlers } from '#lib/shortcuts.ts'
import type { SnoozeChoice } from '#lib/snooze.ts'
import { SnoozeMenu } from '#lib/SnoozeMenu.tsx'
import { useClientLink } from '#lib/use-client-link.ts'
import { useSelectableList } from '#lib/use-selectable-list.ts'

import {
  flatten,
  type Frame,
  groupItems,
  itemId,
  itemName,
  itemTitle,
  KIND_LABEL,
  queueCount,
  rotationText,
  sinceText,
  triageQuery,
  useAssignTriage,
  useDismissTriage,
  useFilmstrip,
  useSnoozeTriage,
} from './api.ts'
import { ROUTE } from './routes.ts'

import listStyles from '#lib/ListPage.module.css'
import styles from './TriagePage.module.css'

/** The build page, with the item's screenshot selected (`?shot=`) when it has one. */
export const openInBuild = (
  workspace: string,
  team: string,
  item: { build: { number: number }; snapshotName: string | null },
): NavigateOptions => ({
  to: '/$workspace/$team/builds/$number',
  params: { workspace, team, number: String(item.build.number) },
  ...(item.snapshotName ? { search: { shot: item.snapshotName } } : {}),
})

export function TriagePage() {
  const { workspace, team } = useParams({ from: ROUTE })
  const names = useCrumbNames(workspace, team)
  useDocumentTitle('Triage', team)
  const announce = useAnnounce()
  const navigate = useNavigate()
  const clientLink = useClientLink()
  const query = useQuery(triageQuery(workspace, team))
  const { data } = query
  const { data: session } = authClient.useSession()
  const me = session?.user

  const [snoozeOpen, setSnoozeOpen] = useState(false)

  const assign = useAssignTriage(workspace, team)
  const snooze = useSnoozeTriage(workspace, team)
  const dismiss = useDismissTriage(workspace, team)

  const groups = groupItems(data?.items ?? [])
  const items = flatten(groups)
  const { selected, select, setSelectedId, listRef, rowProps } = useSelectableList({
    items,
    getId: itemId,
    peekable: false,
  })
  const { frames, loading: framesLoading } = useFilmstrip(workspace, team, selected)

  /** Selects the neighbour of an item that is about to leave the queue, and says what happened. */
  const leave = (item: Triage.Item, message: string) => {
    const next = nextAfterRemoval(items, itemId, itemId(item))
    announce(message)
    setSelectedId(next)
    if (next) queueMicrotask(() => focusRow(document.getElementById('triage-groups'), next))
  }

  const doSnooze = (item: Triage.Item, choice: SnoozeChoice) =>
    snooze.mutate({ ref: item, choice }, { onSuccess: () => leave(item, 'Snoozed') })
  const doDismiss = (item: Triage.Item) =>
    dismiss.mutate({ ref: item }, { onSuccess: () => leave(item, 'Dismissed') })
  const doAssign = (item: Triage.Item) => {
    if (!me) return
    const mine = item.assignee?.id === me.id
    assign.mutate(
      { ref: item, assignee: mine ? null : { id: me.id, name: me.name } },
      { onSuccess: () => announce(mine ? 'Unassigned' : 'Assigned to you') },
    )
  }
  const open = (item: Triage.Item) => void navigate(openInBuild(workspace, team, item))

  useShortcutHandlers({
    // Enter on a row opens the item in its build; on a button or link elsewhere it keeps its meaning.
    open: (_action, event) => {
      const inRow = event.target instanceof Element && event.target.closest('[data-row-id]')
      if ((!inRow && leavesKeyToFocus(event)) || !selected) return false
      open(selected)
      return undefined
    },
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

  const failed = [assign, snooze, dismiss].find((m) => m.error)?.error
  const chip = data ? rotationText(data.rotation) : undefined

  return (
    <>
      <PageHeading
        crumbs={crumbsFor(names)}
        title="Triage"
        actions={
          data && chip && data.rotation.onTriage ? (
            <Badge shape="tag" tone="accent" aria-label={chip}>
              <span className={styles.chip}>
                <Avatar
                  name={data.rotation.onTriage.name}
                  seed={data.rotation.onTriage.id}
                  size={16}
                />
                {chip}
              </span>
            </Badge>
          ) : undefined
        }
      />
      <div className={listStyles['page']}>
        <div className={listStyles['body']}>
          <QueryBoundary query={query} announce="Loading triage" notFound="Team not found" rows={4}>
            {() =>
              items.length === 0 ? (
                <EmptyState title="Nothing to triage">
                  Flaky screenshots, missing baselines and failed builds on the default branch
                  appear here.
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
                              <li
                                key={itemId(item)}
                                className={styles.row}
                                data-selected={
                                  itemId(item) === (selected ? itemId(selected) : '')
                                    ? ''
                                    : undefined
                                }
                                {...rowProps(itemId(item))}
                                onDoubleClick={() => open(item)}
                              >
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
                                    <>
                                      {/* Enter and a double click do the same; the chip says so (and is a click target for a mouse). */}
                                      <span
                                        className={styles.openChip}
                                        aria-hidden="true"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          open(item)
                                        }}
                                      >
                                        Open in build ↗
                                      </span>
                                      {item.assignee ? (
                                        <Avatar
                                          name={item.assignee.name}
                                          seed={item.assignee.id}
                                          size={20}
                                        />
                                      ) : null}
                                    </>
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
                            <>
                              <Preview
                                name={selected.snapshotName}
                                frame={frames.find((f) => f.number === selected.build.number)}
                                loading={framesLoading}
                                link={clientLink(openInBuild(workspace, team, selected))}
                              />
                              <Filmstrip
                                name={selected.snapshotName}
                                frames={frames}
                                loading={framesLoading}
                                linkOf={(frame) =>
                                  clientLink(
                                    openInBuild(workspace, team, {
                                      snapshotName: selected.snapshotName,
                                      build: { number: frame.number },
                                    }),
                                  )
                                }
                              />
                            </>
                          ) : null}
                        </div>
                      </Pane>
                    ) : null}
                  </div>
                </>
              )
            }
          </QueryBoundary>
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

/**
 * The screenshot at a size you can judge it by, as a link to the same place in the build, with a
 * pill that says so (the outline on hover is the pointer's cue).
 */
function Preview({
  name,
  frame,
  loading,
  link,
}: {
  name: string
  frame: Frame | undefined
  loading: boolean
  link: { href: string; onClick: MouseEventHandler<HTMLElement> }
}) {
  if (!frame?.sha256) {
    return loading ? (
      <Text variant="small" tone="secondary">
        Loading the screenshot
      </Text>
    ) : null
  }
  return (
    <a
      className={styles.preview}
      href={link.href}
      onClick={link.onClick}
      aria-label={`Open ${name} in build #${frame.number}`}
    >
      <span className={styles.previewImage}>
        <img src={fileUrl(frame.sha256)} alt="" />
      </span>
      <span className={styles.pill} aria-hidden="true">
        Open in build ↗
      </span>
    </a>
  )
}

function Filmstrip({
  name,
  frames,
  loading,
  linkOf,
}: {
  name: string
  frames: readonly Frame[]
  loading: boolean
  linkOf: (frame: Frame) => { href: string; onClick: MouseEventHandler<HTMLElement> }
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
      {frames.map((frame) => {
        const link = linkOf(frame)
        return (
          <li key={frame.number}>
            <a
              className={styles.frame}
              href={link.href}
              onClick={link.onClick}
              aria-label={`Open ${name} in build #${frame.number}`}
            >
              <span className={styles.thumb}>
                {frame.src ? <img src={frame.src} alt="" /> : null}
              </span>
              <span className={styles.frameMeta}>
                <StatusIcon status={frame.status} label={frame.label} size={12} />#{frame.number}
              </span>
            </a>
          </li>
        )
      })}
    </ol>
  )
}
