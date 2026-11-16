import type { Triage, Undo } from '@circi/api'
import { flakyEvidence } from '@circi/core'
import {
  Avatar,
  Badge,
  Button,
  ContextMenu,
  EmptyState,
  ExpandMoreIcon,
  ListGroup,
  ListRow,
  NoResults,
  Pane,
  StatusIcon,
  Text,
  visuallyHidden,
} from '@circi/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type NavigateOptions, useNavigate, useParams, useRouter } from '@tanstack/react-router'
import { type MouseEventHandler, type ReactNode, useEffect, useState } from 'react'

import { fileUrl } from '#features/builds/api/index.ts'
import { useCrumbNames } from '#features/projects/crumb-names.ts'
import { authClient } from '#lib/auth-client.ts'
import { PaneSlot } from '#lib/DetailSheet.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { findIn, useFindParam } from '#lib/find.ts'
import { FindField } from '#lib/FindField.tsx'
import { FlakyWhy } from '#lib/FlakyWhy.tsx'
import { focusRow, leavesKeyToFocus, nextAfterRemoval } from '#lib/list-keys.ts'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { PaneHandle, paneVars } from '#lib/PaneHandle.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { Age } from '#lib/RelativeTime.tsx'
import {
  copyLinkItem,
  menuEntries,
  openInNewTabItem,
  separator,
  snoozeItems,
} from '#lib/row-menu.ts'
import { useShortcutHandlers } from '#lib/shortcuts.ts'
import type { SnoozeChoice } from '#lib/snooze.ts'
import { SnoozeMenu } from '#lib/SnoozeMenu.tsx'
import { usePaneWidth } from '#lib/stores/pane-store.ts'
import type { ToastInput } from '#lib/stores/toast-store.ts'
import { toast } from '#lib/toast.ts'
import { refreshAll, withUndo } from '#lib/undo.ts'
import { useClientLink } from '#lib/use-client-link.ts'
import { usePhone } from '#lib/use-phone.ts'
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
  project: string,
  item: { build: { number: number }; snapshotName: string | null },
): NavigateOptions => ({
  to: '/$workspace/$project/builds/$number',
  params: { workspace, project, number: String(item.build.number) },
  ...(item.snapshotName ? { search: { shot: item.snapshotName } } : {}),
})

export function TriagePage() {
  const { workspace, project } = useParams({ from: ROUTE })
  const names = useCrumbNames(workspace, project)
  useDocumentTitle('Triage', project)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const router = useRouter()
  const clientLink = useClientLink()
  const paneWidth = usePaneWidth('triage-pane')
  const query = useQuery(triageQuery(workspace, project))
  const { data } = query
  const { data: session } = authClient.useSession()
  const me = session?.user

  const [snoozeOpen, setSnoozeOpen] = useState(false)
  // On a phone the selected item opens as a sheet over the list (the one tapped).
  const phone = usePhone()
  const [sheetFor, setSheetFor] = useState<string | undefined>(undefined)
  /** Items dealt with since the page opened (snoozed, dismissed, compared again). */
  const [handled, setHandled] = useState(0)

  const assign = useAssignTriage(workspace, project)
  const snooze = useSnoozeTriage(workspace, project)
  const dismiss = useDismissTriage(workspace, project)
  const rerun = useRerunTriage(workspace, project)

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
  const { image, loading: imageLoading } = useItemImage(workspace, project, selected)

  /** Selects the neighbour of an item that is about to leave the queue, and says what happened. */
  const leave = (item: Triage.Item, input: ToastInput) => {
    const next = nextAfterRemoval(items, itemId, itemId(item))
    toast.show(input)
    setHandled((n) => n + 1)
    setSelectedId(next)
    if (next) queueMicrotask(() => focusRow(document.getElementById('triage-groups'), next))
  }

  // Each change acts at once and its toast offers Undo (the server takes it back).
  const undoable = (message: string, undo: Undo.Token | null) =>
    withUndo(message, undo, { workspace, project }, refreshAll(queryClient))

  const doSnooze = (item: Triage.Item, choice: SnoozeChoice) =>
    snooze.mutate(
      { ref: item, choice },
      { onSuccess: (answer) => leave(item, undoable('Snoozed', answer.undo)) },
    )
  const doDismiss = (item: Triage.Item) =>
    dismiss.mutate(
      { ref: item },
      { onSuccess: (answer) => leave(item, undoable('Dismissed', answer.undo)) },
    )
  // Comparing again has no Undo: the new comparison can't be taken back.
  const doRerun = (item: Triage.Item) =>
    rerun.mutate(
      { ref: refOf(item), number: item.build.number },
      { onSuccess: () => leave(item, { message: 'Comparing again' }) },
    )
  const doAssign = (item: Triage.Item) => {
    if (!me) return
    const mine = item.assignee?.id === me.id
    assign.mutate(
      {
        ref: item,
        assignee: mine ? null : { id: me.id, name: me.name, image: me.image ?? null, auto: false },
      },
      {
        onSuccess: (answer) =>
          toast.show(undoable(mine ? 'Unassigned' : 'Assigned to you', answer.undo)),
      },
    )
  }
  const open = (item: Triage.Item) => void navigate(openInBuild(workspace, project, item))

  /** A row's right-click menu: what the pane's buttons and the keys do, for that item. */
  const rowMenu = (item: Triage.Item) => {
    const href = router.buildLocation(openInBuild(workspace, project, item)).href
    const mine = me !== undefined && item.assignee?.id === me.id
    return menuEntries([
      { label: 'Open in build', onSelect: () => open(item) },
      openInNewTabItem(href),
      copyLinkItem(href),
      separator,
      item.kind === 'failed' && { label: 'Re-run comparison', onSelect: () => doRerun(item) },
      me
        ? {
            label: mine ? 'Unassign me' : 'Assign to me',
            onSelect: () => doAssign(item),
          }
        : null,
      ...snoozeItems(true, (choice) => doSnooze(item, choice)),
      { label: 'Dismiss', onSelect: () => doDismiss(item) },
    ])
  }

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
  const chip = data ? rotationText(data.rotation, session?.user.id) : undefined

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
        find={
          <FindField
            noun="triage items"
            value={find}
            onChange={setFind}
            disabled={!data || total.length === 0}
          />
        }
        actions={
          data && chip && data.rotation.onTriage ? (
            <Badge shape="tag" aria-label={chip}>
              <span className={styles.chip}>
                <Avatar type="user" {...data.rotation.onTriage} size={16} />
                <span className={styles.chipLabel}>{chip}</span>
              </span>
            </Badge>
          ) : undefined
        }
      />
      <div className={listStyles['page']}>
        <div className={listStyles['body']}>
          <QueryBoundary
            query={query}
            announce="Loading triage"
            notFound="Project not found"
            rows={4}
          >
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
                  <div
                    className={listStyles['split']}
                    style={paneVars({ '--circi-pane-width': ['triage-pane', paneWidth] })}
                  >
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
                                {...rowProps(itemId(item))}
                                onDoubleClick={() => open(item)}
                              >
                                <ContextMenu items={rowMenu(item)}>
                                  <ListRow
                                    density="two-line"
                                    selected={itemId(item) === (selected ? itemId(selected) : '')}
                                    onClick={() => {
                                      select(item)
                                      setSheetFor(itemId(item))
                                    }}
                                    // Enter, a double click and the menu open the build; the preview in the pane says so once.
                                    title={<span aria-hidden="true">{itemTitle(item)}</span>}
                                    subtitle={<span aria-hidden="true">{itemSubtitle(item)}</span>}
                                    trailing={
                                      <>
                                        {item.assignee ? (
                                          <Avatar
                                            type="user"
                                            id={item.assignee.id}
                                            name={item.assignee.name}
                                            image={item.assignee.image}
                                            size={20}
                                          />
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
                                  </ListRow>
                                </ContextMenu>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                    {selected ? (
                      <PaneSlot
                        phone={phone}
                        open={sheetFor === itemId(selected)}
                        onClose={() => setSheetFor(undefined)}
                        label="Details"
                        handle={
                          <PaneHandle
                            pane="triage-pane"
                            edge="start"
                            cssVar="--circi-pane-width"
                            at="calc(100% - var(--circi-pane-width) - 6px)"
                          />
                        }
                      >
                        <Pane
                          label="Details"
                          context={KIND_LABEL[selected.kind]}
                          width="resizable"
                          bare={phone}
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
                                {selected.reason ? (
                                  <Section label="Why it's flaky">
                                    <FlakyWhy
                                      reason={selected.reason}
                                      name={selected.snapshotName ?? undefined}
                                      linkOf={(number) =>
                                        clientLink(
                                          openInBuild(workspace, project, {
                                            snapshotName: selected.snapshotName,
                                            build: { number },
                                          }),
                                        )
                                      }
                                    />
                                  </Section>
                                ) : null}
                                <Film
                                  item={selected}
                                  linkOf={(number) =>
                                    clientLink(
                                      openInBuild(workspace, project, {
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
                                    link={clientLink(openInBuild(workspace, project, selected))}
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
                                    link={clientLink(openInBuild(workspace, project, selected))}
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
                                    <Avatar
                                      type="user"
                                      id={selected.assignee.id}
                                      name={selected.assignee.name}
                                      image={selected.assignee.image}
                                      size={20}
                                    />
                                    {selected.assignee.name}
                                    {selected.assignee.auto ? (
                                      <Text tone="tertiary">· on triage</Text>
                                    ) : null}
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
                      </PaneSlot>
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
      aria-label={`Open in build #${number}: ${name}`}
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
  const returned = new Set(item.reason ? flakyEvidence(item.reason).map((e) => e.build) : [])
  return (
    <Section label={`Last ${item.history.length} commits on main`}>
      <ol aria-label={changedText(item.history)} className={styles.film}>
        {item.history.map((h) => {
          const link = linkOf(h.number)
          return (
            <li key={h.number}>
              <a
                className={styles.cell}
                data-changed={h.changed ? '' : undefined}
                data-evidence={returned.has(h.number) ? '' : undefined}
                href={link.href}
                onClick={link.onClick}
                title={h.changed ? 'Changed in this build' : 'Same'}
                aria-label={`Open ${item.snapshotName ?? ''} in build #${h.number}, ${h.changed ? 'changed' : 'same'}${returned.has(h.number) ? ', part of why it is flaky' : ''}`}
              >
                <b>{h.changed ? '~' : ''}</b>
                <span>#{h.number}</span>
              </a>
            </li>
          )
        })}
      </ol>
      {/* The tilde is a mark, not a word: say it here (a title tooltip is no help on a phone). */}
      <Text as="p" variant="small" tone="tertiary">
        ~ changed in that build
      </Text>
    </Section>
  )
}
