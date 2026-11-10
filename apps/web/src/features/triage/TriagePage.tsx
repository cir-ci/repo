import type { Triage } from '@circi/api'
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ExpandMoreIcon,
  ListGroup,
  ListRow,
  NoResults,
  Pane,
  StatusIcon,
  Text,
  useAnnounce,
  visuallyHidden,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { type NavigateOptions, useNavigate, useParams } from '@tanstack/react-router'
import { type MouseEventHandler, type ReactNode, useEffect, useState } from 'react'

import { fileUrl } from '#features/builds/api/index.ts'
import { useCrumbNames } from '#features/teams/crumb-names.ts'
import { authClient } from '#lib/auth-client.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { findIn, useFindParam } from '#lib/find.ts'
import { FindField } from '#lib/FindField.tsx'
import { focusRow, leavesKeyToFocus, nextAfterRemoval } from '#lib/list-keys.ts'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { Age } from '#lib/RelativeTime.tsx'
import { useShortcutHandlers } from '#lib/shortcuts.ts'
import type { SnoozeChoice } from '#lib/snooze.ts'
import { SnoozeMenu } from '#lib/SnoozeMenu.tsx'
import { useClientLink } from '#lib/use-client-link.ts'
import { useSelectFromParam } from '#lib/use-select-from-param.ts'
import { useSelectableList } from '#lib/use-selectable-list.ts'

import {
  blockingText,
  changedText,
  flatten,
  groupItems,
  itemId,
  itemName,
  itemSubtitle,
  itemTitle,
  KIND_LABEL,
  refOf,
  rotationText,
  triageQuery,
  useAssignTriage,
  useDismissTriage,
  useItemImage,
  useRerunTriage,
  useSnoozeTriage,
  waitingFor,
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
  /** Items dealt with since the page opened (snoozed, dismissed, compared again). */
  const [handled, setHandled] = useState(0)

  const assign = useAssignTriage(workspace, team)
  const snooze = useSnoozeTriage(workspace, team)
  const dismiss = useDismissTriage(workspace, team)
  const rerun = useRerunTriage(workspace, team)

  const [find, setFind] = useFindParam()
  const awake = groupItems(data?.items ?? [])
  const total = flatten(awake)
  const groups = groupItems(findIn(total, find, triageFields))
  const items = flatten(groups)
  const { selected, select, setSelectedId, listRef, rowProps } = useSelectableList({
    items,
    getId: itemId,
    peekable: false,
  })
  useSelectFromParam(setSelectedId)
  const { image, loading: imageLoading } = useItemImage(workspace, team, selected)

  /** Selects the neighbour of an item that is about to leave the queue, and says what happened. */
  const leave = (item: Triage.Item, message: string) => {
    const next = nextAfterRemoval(items, itemId, itemId(item))
    announce(message)
    setHandled((n) => n + 1)
    setSelectedId(next)
    if (next) queueMicrotask(() => focusRow(document.getElementById('triage-groups'), next))
  }

  const doSnooze = (item: Triage.Item, choice: SnoozeChoice) =>
    snooze.mutate({ ref: item, choice }, { onSuccess: () => leave(item, 'Snoozed') })
  const doDismiss = (item: Triage.Item) =>
    dismiss.mutate({ ref: item }, { onSuccess: () => leave(item, 'Dismissed') })
  const doRerun = (item: Triage.Item) =>
    rerun.mutate(
      { ref: refOf(item), number: item.build.number },
      { onSuccess: () => leave(item, 'Comparing again') },
    )
  const doAssign = (item: Triage.Item) => {
    if (!me) return
    const mine = item.assignee?.id === me.id
    assign.mutate(
      { ref: item, assignee: mine ? null : { id: me.id, name: me.name, image: me.image ?? null } },
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

  const failed = [assign, snooze, dismiss, rerun].find((m) => m.error)?.error
  const chip = data ? rotationText(data.rotation) : undefined

  return (
    <>
      <PageHeading
        crumbs={crumbsFor(names)}
        title="Triage"
        after={
          data && total.length > 0 ? (
            <Text variant="small" tone="tertiary" role="status">
              {items.length}
              {handled > 0 ? ` · ${handled} handled` : ''}
            </Text>
          ) : null
        }
        actions={
          data ? (
            <>
              {total.length > 0 ? (
                <FindField noun="triage items" value={find} onChange={setFind} />
              ) : null}
              {chip && data.rotation.onTriage ? (
                <Badge shape="tag" tone="accent" aria-label={chip}>
                  <span className={styles.chip}>
                    <Avatar type="user" {...data.rotation.onTriage} size={16} />
                    {chip}
                  </span>
                </Badge>
              ) : null}
            </>
          ) : undefined
        }
      />
      <div className={listStyles['page']}>
        <div className={listStyles['body']}>
          <QueryBoundary query={query} announce="Loading triage" notFound="Team not found" rows={4}>
            {() =>
              total.length === 0 ? (
                <div className={styles.empty}>
                  <EmptyState tone="success" title="Triage is clear">
                    Flaky screenshots, missing baselines and failed builds on the default branch
                    appear here.
                  </EmptyState>
                </div>
              ) : items.length === 0 ? (
                <div className={styles.empty}>
                  <NoResults noun="triage item" query={find} onClear={() => setFind('')} />
                </div>
              ) : (
                <>
                  {failed ? (
                    <Text tone="failed" role="alert">
                      {failed.message}
                    </Text>
                  ) : null}
                  <div className={listStyles['split']}>
                    <div className={styles.groups} id="triage-groups" ref={listRef}>
                      {groups.map((group) => (
                        <section key={group.kind} aria-labelledby={`triage-${group.kind}`}>
                          <ListGroup
                            id={`triage-${group.kind}`}
                            glyph={<StatusIcon status={GLYPH[group.kind]} decorative />}
                            label={group.label}
                            count={group.items.length}
                            countLabel={`${group.items.length} ${group.items.length === 1 ? 'item' : 'items'}`}
                          />
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
                                        <Avatar type="user" {...item.assignee} size={20} />
                                      ) : (
                                        <span
                                          className={styles.unassigned}
                                          role="img"
                                          aria-label="Unassigned"
                                        />
                                      )}
                                      <span className={styles.age} aria-hidden="true">
                                        <Age iso={item.build.createdAt} />
                                      </span>
                                    </>
                                  }
                                >
                                  <span style={visuallyHidden}>{`${itemName(item)}. `}</span>
                                  <span className={styles.title} aria-hidden="true">
                                    <Text truncate>{itemTitle(item)}</Text>
                                  </span>
                                  <span className={listStyles['meta']} aria-hidden="true">
                                    <Text truncate variant="small" tone="tertiary">
                                      {itemSubtitle(item)}
                                    </Text>
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
                        context={KIND_LABEL[selected.kind]}
                        width="lg"
                        actions={
                          <>
                            {selected.kind === 'failed' ? (
                              <Button variant="primary" onClick={() => doRerun(selected)}>
                                Re-run comparison
                              </Button>
                            ) : null}
                            <Button
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
                                <Button variant="ghost" aria-keyshortcuts="h">
                                  Snooze
                                  <ExpandMoreIcon size={12} aria-hidden="true" />
                                </Button>
                              }
                            />
                            <Button
                              variant="ghost"
                              aria-keyshortcuts="d"
                              onClick={() => doDismiss(selected)}
                            >
                              Dismiss
                            </Button>
                          </>
                        }
                      >
                        <div className={styles.paneBody}>
                          <h3 className={styles.paneTitle}>{itemTitle(selected)}</h3>
                          {selected.kind === 'flaky' ? (
                            <>
                              <Film
                                item={selected}
                                linkOf={(number) =>
                                  clientLink(
                                    openInBuild(workspace, team, {
                                      snapshotName: selected.snapshotName,
                                      build: { number },
                                    }),
                                  )
                                }
                              />
                              <Section label="Where it changes">
                                <Preview
                                  name={selected.snapshotName ?? ''}
                                  number={selected.build.number}
                                  sha256={image?.sha256}
                                  loading={imageLoading}
                                  link={clientLink(openInBuild(workspace, team, selected))}
                                />
                              </Section>
                            </>
                          ) : null}
                          {selected.kind === 'no_baseline' ? (
                            <div className={styles.pair}>
                              <Section label="Baseline on main">
                                <div className={styles.none}>None yet</div>
                              </Section>
                              <Section label={`First seen in #${selected.build.number}`}>
                                <Preview
                                  name={selected.snapshotName ?? ''}
                                  number={selected.build.number}
                                  sha256={image?.sha256}
                                  loading={imageLoading}
                                  link={clientLink(openInBuild(workspace, team, selected))}
                                />
                              </Section>
                            </div>
                          ) : null}
                          {selected.kind === 'failed' && selected.error ? (
                            <pre className={styles.log}>{selected.error}</pre>
                          ) : null}
                          <dl className={styles.facts}>
                            <dt>Assignee</dt>
                            <dd>
                              {selected.assignee ? (
                                <span className={styles.person}>
                                  <Avatar type="user" {...selected.assignee} size={20} />
                                  {selected.assignee.name}
                                </span>
                              ) : (
                                <Text tone="tertiary">
                                  Unassigned
                                  {data?.rotation.onTriage
                                    ? ` · ${data.rotation.onTriage.name} is on triage`
                                    : ''}
                                </Text>
                              )}
                            </dd>
                            <dt>In triage for</dt>
                            <dd>
                              <Waiting iso={selected.build.createdAt} />
                            </dd>
                            <dt>Blocking</dt>
                            <dd>
                              <Text tone="secondary">{blockingText(selected)}</Text>
                            </dd>
                          </dl>
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

/** What a find text is looked for in: the screenshot, the build, its branch and commit, the kind and the assignee. */
const triageFields = (item: Triage.Item) => [
  item.snapshotName,
  `Build #${item.build.number}`,
  `#${item.build.number}`,
  item.build.branch,
  item.build.commitSha,
  KIND_LABEL[item.kind],
  item.assignee?.name,
]

// No baseline is grey (nothing to compare yet, not a change); flaky and failed carry their state colour.
const GLYPH = { flaky: 'flaky', no_baseline: 'neutral', failed: 'failed' } as const

/** "3 days", refreshed every minute. */
function Waiting({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return <>{waitingFor(iso, now)}</>
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>{label}</span>
      {children}
    </div>
  )
}

/**
 * The screenshot at a size you can judge it by, as a link to the same place in the build, with a
 * pill that says so (the outline on hover is the pointer's cue).
 */
function Preview({
  name,
  number,
  sha256,
  loading,
  link,
}: {
  name: string
  number: number
  sha256: string | undefined
  loading: boolean
  link: { href: string; onClick: MouseEventHandler<HTMLElement> }
}) {
  if (!sha256) {
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
      aria-label={`Open ${name} in build #${number}`}
    >
      <span className={styles.previewImage}>
        <img src={fileUrl(sha256)} alt="" />
      </span>
      <span className={styles.pill} aria-hidden="true">
        Open in build ↗
      </span>
    </a>
  )
}

/** The last builds on the default branch as cells: orchid (the flaky colour) with a tilde where the screenshot changed. */
function Film({
  item,
  linkOf,
}: {
  item: Triage.Item
  linkOf: (number: number) => { href: string; onClick: MouseEventHandler<HTMLElement> }
}) {
  if (item.history.length === 0) return null
  return (
    <Section label={`Last ${item.history.length} builds on main`}>
      <ol aria-label={changedText(item.history)} className={styles.film}>
        {item.history.map((h) => {
          const link = linkOf(h.number)
          return (
            <li key={h.number}>
              <a
                className={styles.cell}
                data-changed={h.changed ? '' : undefined}
                href={link.href}
                onClick={link.onClick}
                title={h.changed ? 'Changed in this build' : 'Same'}
                aria-label={`Open ${item.snapshotName ?? ''} in build #${h.number}, ${h.changed ? 'changed' : 'same'}`}
              >
                <b>{h.changed ? '~' : ''}</b>
                <span>#{h.number}</span>
              </a>
            </li>
          )
        })}
      </ol>
    </Section>
  )
}
