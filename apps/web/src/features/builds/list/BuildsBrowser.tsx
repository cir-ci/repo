import type { Build } from '@circi/api'
import {
  Button,
  type Menu,
  CheckIcon,
  CommandBlock,
  ContextMenu,
  EmptyState,
  ConstructionIcon,
  NoFilterResults,
  NoResults,
  ListGroup,
  ListRow,
  Pane,
  SectionHeader,
  StatusIcon,
  Text,
  useAnnounce,
  visuallyHidden,
} from '@circi/ui'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { type ReactNode, useState } from 'react'

import { buildState } from '#features/builds/build-state.ts'
import { CountsSummary } from '#features/builds/CountsSummary.tsx'
import { shotReview } from '#features/builds/diff-status.ts'
import {
  BUILDS_PAGE_SIZE,
  projectQuery,
  useRejectReasonRequired,
  useBulkRequestReview,
  useBulkReview,
  workspaceBuildsQuery,
} from '#features/projects/api/index.ts'
import { MemberPicker } from '#features/reviews/MemberPicker.tsx'
import { useSaveView, viewsQuery, viewWithFilters } from '#features/views/api.ts'
import { SaveViewDialog } from '#features/views/SaveViewDialog.tsx'
import { PaneHandle, paneVars } from '#lib/PaneHandle.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { copyText, copyLinkItem, menuEntries, openInNewTabItem, separator } from '#lib/row-menu.ts'
import { useShortcutHandlers } from '#lib/shortcuts.ts'
import { useDisplayStore } from '#lib/stores/display-store.ts'
import { useListStore } from '#lib/stores/list-store.ts'
import { usePaneWidth } from '#lib/stores/pane-store.ts'
import { copiedToast, toast } from '#lib/toast.ts'
import { refreshAll, withUndo } from '#lib/undo.ts'
import { useClientLink } from '#lib/use-client-link.ts'
import { useSelectableList } from '#lib/use-selectable-list.ts'

import { BuildFilterBar } from './BuildFilterBar.tsx'
import {
  type BuildFilters,
  type FilterField,
  hasFilters,
  parseFilters,
  toSearch,
} from './builds-filters.ts'
import { BulkRejectDialog } from './BulkRejectDialog.tsx'
import { type DisplayOptions, groupBuilds } from './display-options.ts'

import styles from './BuildsBrowser.module.css'

const countText = (n: number) => `${n} ${n === 1 ? 'build' : 'builds'}`

/**
 * A project's builds: filter chips, display options, grouped rows with J / K, X to select, Space
 * to peek, and a bulk bar once something is selected. The filters belong to the page (the URL on
 * the project page, a saved view's on its own), so they come in as props.
 */
export function BuildsBrowser({
  workspace,
  project,
  filters,
  onFiltersChange,
  before,
  cursor: pageCursor,
  onCursorChange,
  canSave = true,
}: BuildsBrowser.Props) {
  const peekWidth = usePaneWidth('builds-peek')
  const clientLink = useClientLink()
  const router = useRouter()
  const announce = useAnnounce()
  const queryClient = useQueryClient()
  // Without a project this is the whole workspace's list (a saved view with no project).
  const scoped = project !== undefined
  // The server orders the list (and pages it in that order); grouping happens on the page.
  const display = useDisplayStore((s) => s.display)
  // The list stays on screen while the next one loads, so the find field under typing is not remounted.
  const projectResult = useQuery({
    ...projectQuery(workspace, project ?? '', before, filters, display.order),
    enabled: scoped,
    placeholderData: keepPreviousData,
  })
  const workspaceResult = useQuery({
    ...workspaceBuildsQuery(workspace, pageCursor, filters, display.order),
    enabled: !scoped,
    placeholderData: keepPreviousData,
  })
  const query = scoped ? projectResult : workspaceResult
  const { data } = query
  const projectOf = (b: Row) => b.project?.slug ?? project ?? ''

  const setDisplay = useDisplayStore((s) => s.setDisplay)
  const clearChecked = useListStore((s) => s.clearChecked)
  const [open, setOpen] = useState<FilterField | 'display'>()
  const selected = useListStore((s) => s.checked)
  const [rejecting, setRejecting] = useState(false)
  // The builds the reject and request-review dialogs act on: the selection (from the bulk bar) or one row (from its menu).
  const [target, setTarget] = useState<readonly Row[]>([])
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)

  // Bulk decisions are one project's (a single transaction); a workspace-wide list only browses.
  const bulk = useBulkReview(workspace, project ?? '')
  const reasonRequired = useRejectReasonRequired(workspace, project ?? '')
  const bulkRequest = useBulkRequestReview(workspace, project ?? '')
  const saveView = useSaveView(workspace)
  const views = useQuery({ ...viewsQuery(workspace), enabled: canSave })

  const builds: readonly Row[] = data?.builds ?? []
  const oldest = builds.at(-1)?.number
  const groups = groupBuilds(builds, display.groupBy)
  const flat = groups.flatMap((g) => g.builds)
  const openBuild = (b: Row) =>
    void router.navigate({
      to: '/$workspace/$project/builds/$number',
      params: { workspace, project: projectOf(b), number: String(b.number) },
    })
  const chosen = flat.filter((b) => selected.has(b.id))
  const filtered = hasFilters(filters)

  const {
    selected: cursor,
    peek,
    listRef,
    rowProps,
  } = useSelectableList({ items: flat, getId: (b) => b.id })

  useShortcutHandlers({
    select: () => {
      if (!cursor || !scoped) return
      const on = useListStore.getState().toggleChecked(cursor.id)
      const next = useListStore.getState().checked
      const count = flat.filter((b) => next.has(b.id)).length
      announce(`${on ? 'Selected' : 'Deselected'} build ${cursor.number}, ${count} selected`)
    },
    filter: () => setOpen('status'),
    display: () => setOpen('display'),
  })

  const decide = (rows: readonly Row[], decision: 'approved' | 'rejected', reason?: string) =>
    bulk.mutate(
      { buildIds: rows.map((b) => b.id), decision, ...(reason ? { reason } : {}) },
      {
        onSuccess: () => {
          // No Undo: the server keeps no token for a decision on several builds at once.
          toast(`${decision === 'approved' ? 'Approved' : 'Rejected'} ${countText(rows.length)}`)
          if (rows.some((b) => selected.has(b.id))) clearChecked()
          setRejecting(false)
        },
      },
    )

  /**
   * What a right click on a row acts on: the whole selection when the row is in it, else that
   * row alone (the selection is left as it is).
   */
  const actOn = (b: Row): readonly Row[] => (selected.has(b.id) ? chosen : [b])

  const rowMenu = (b: Row, href: string): Menu.Entry[] => {
    const rows = actOn(b)
    const many = rows.length > 1
    const noun = many ? countText(rows.length) : `build ${b.number}`
    return menuEntries([
      { label: 'Open', onSelect: () => openBuild(b) },
      openInNewTabItem(href),
      copyLinkItem(href),
      b.commitSha
        ? { label: 'Copy commit SHA', onSelect: () => void copyText(b.commitSha, 'Commit SHA') }
        : null,
      // Reviewing is one project's (a single transaction); a workspace-wide list only browses.
      scoped && separator,
      scoped && {
        label: many ? `Approve ${noun}` : 'Approve',
        onSelect: () => decide(rows, 'approved'),
      },
      scoped && {
        label: many ? `Reject ${noun}` : 'Reject',
        tone: 'danger',
        onSelect: () => {
          setTarget(rows)
          setRejecting(true)
        },
      },
      scoped && {
        label: many ? `Request review of ${noun}` : 'Request review',
        onSelect: () => {
          setTarget(rows)
          setPicking(true)
        },
      },
      Boolean(b.branch || b.author) && separator,
      b.branch
        ? {
            label: `Filter by branch ${b.branch}`,
            onSelect: () => onFiltersChange({ ...filters, branch: b.branch ?? '' }),
          }
        : null,
      b.author
        ? {
            label: `Filter by ${b.author.name ?? b.author.login}`,
            onSelect: () => onFiltersChange({ ...filters, author: b.author?.login ?? '' }),
          }
        : null,
    ])
  }

  const failed = bulk.error ?? bulkRequest.error
  const title = before ? 'Older builds' : 'Builds'

  return (
    <>
      <SectionHeader title={title} />
      {data && (builds.length > 0 || filtered) ? (
        <BuildFilterBar
          workspace={workspace}
          project={project}
          filters={filters}
          onFiltersChange={onFiltersChange}
          display={display}
          onDisplayChange={(next) => {
            // A page cursor belongs to one order: a new order starts from its first page.
            if (next.order !== display.order) {
              if (scoped) onFiltersChange(filters)
              else onCursorChange?.(undefined)
            }
            setDisplay(next)
          }}
          open={open}
          onOpenChange={setOpen}
          onSaveView={canSave ? () => setSaving(true) : undefined}
          savedAs={viewWithFilters(views.data?.views, project, filters)?.name}
        />
      ) : null}
      <QueryBoundary<NonNullable<typeof data>>
        query={query}
        announce="Loading builds"
        notFound={scoped ? "This project doesn't exist" : "This workspace doesn't exist"}
      >
        {() =>
          builds.length === 0 ? (
            filtered && Object.keys(parseFilters({ ...filters })).join() === 'q' ? (
              <NoResults noun="build" query={filters.q ?? ''} onClear={() => onFiltersChange({})} />
            ) : filtered ? (
              <NoFilterResults
                plural="builds"
                scope={scoped ? project : workspace}
                onClear={() => onFiltersChange({})}
              />
            ) : before ? (
              <EmptyState icon={<ConstructionIcon />} title="No older builds" />
            ) : (
              <EmptyState
                icon={<ConstructionIcon />}
                title="No builds yet"
                action={
                  scoped ? (
                    <CommandBlock
                      onCopy={copiedToast('Command')}
                      command={`CIRCI_TOKEN=… CIRCI_API_URL=${window.location.origin} \\\n  npx circi upload ./screenshots --wait`}
                    />
                  ) : undefined
                }
              >
                {scoped
                  ? 'Builds appear here once your CI uploads screenshots.'
                  : `Builds from every project in ${workspace} appear here.`}
              </EmptyState>
            )
          ) : (
            <>
              <div
                className={styles.split}
                style={paneVars({ '--circi-pane-width': ['builds-peek', peekWidth] })}
              >
                <div className={styles.groups} ref={listRef}>
                  {groups.map((group) => (
                    <GroupRows key={group.key} label={group.label} count={group.builds.length}>
                      {group.builds.map((b) => {
                        const state = buildState(b)
                        const checked = selected.has(b.id)
                        const link = clientLink({
                          to: '/$workspace/$project/builds/$number',
                          params: { workspace, project: projectOf(b), number: String(b.number) },
                        })
                        return (
                          <li
                            key={b.id}
                            {...rowProps(b.id)}
                            data-checked={checked ? '' : undefined}
                          >
                            <ContextMenu items={rowMenu(b, link.href)}>
                              <ListRow
                                className={styles.row}
                                selected={b.id === cursor?.id}
                                {...link}
                                leading={
                                  <span className={styles.lead}>
                                    {checked ? (
                                      <span className={styles.check} aria-hidden="true">
                                        <CheckIcon size={12} strokeWidth={3} />
                                      </span>
                                    ) : null}
                                    <StatusIcon status={state.status} label={state.label} />
                                  </span>
                                }
                                trailing={
                                  display.show.counts ? (
                                    <span className={styles.trailing}>
                                      <CountsSummary
                                        counts={b.counts}
                                        review={shotReview(b)}
                                        includeUnchanged={false}
                                      />
                                    </span>
                                  ) : undefined
                                }
                                title={
                                  <>
                                    {checked ? (
                                      <span style={visuallyHidden}>Selected, </span>
                                    ) : null}
                                    Build #{b.number}
                                    {b.name !== 'default' ? (
                                      <span className={styles.name}> · {b.name}</span>
                                    ) : null}
                                  </>
                                }
                                subtitle={<RowMeta build={b} show={display.show} />}
                              />
                            </ContextMenu>
                          </li>
                        )
                      })}
                    </GroupRows>
                  ))}
                </div>
                {peek && cursor ? (
                  <>
                    <PaneHandle
                      pane="builds-peek"
                      edge="start"
                      cssVar="--circi-pane-width"
                      at="calc(100% - var(--circi-pane-width) - 6px)"
                    />
                    <Pane
                      width="resizable"
                      label="Preview"
                      context={`#${cursor.number}`}
                      actions={
                        <Button
                          size="sm"
                          variant="primary"
                          {...clientLink({
                            to: '/$workspace/$project/builds/$number',
                            params: {
                              workspace,
                              project: projectOf(cursor),
                              number: String(cursor.number),
                            },
                          })}
                        >
                          Open build
                        </Button>
                      }
                    >
                      <BuildPeek build={cursor} />
                    </Pane>
                  </>
                ) : null}
              </div>
              {/* Primer: pagination sits directly below the collection it pages. */}
              <div className={styles.pager}>
                {scoped ? (
                  <>
                    {before ? (
                      <Button
                        {...clientLink({
                          to: '/$workspace/$project',
                          params: { workspace, project },
                          search: toSearch(filters),
                        })}
                      >
                        Newest builds
                      </Button>
                    ) : null}
                    {builds.length === BUILDS_PAGE_SIZE && oldest ? (
                      <Button
                        {...clientLink({
                          to: '/$workspace/$project',
                          params: { workspace, project },
                          search: toSearch(filters, oldest),
                        })}
                      >
                        Older builds
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <>
                    {pageCursor ? (
                      <Button onClick={() => onCursorChange?.(undefined)}>Newest builds</Button>
                    ) : null}
                    {workspaceResult.data?.next ? (
                      <Button
                        onClick={() => onCursorChange?.(workspaceResult.data?.next ?? undefined)}
                      >
                        Older builds
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </>
          )
        }
      </QueryBoundary>
      {chosen.length > 0 ? (
        <div role="region" aria-label="Bulk actions" className={styles.bulk}>
          <Text variant="small">{chosen.length} selected</Text>
          <Button
            size="sm"
            variant="primary"
            loading={bulk.isPending && !rejecting}
            onClick={() => decide(chosen, 'approved')}
          >
            Approve
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setTarget(chosen)
              setRejecting(true)
            }}
          >
            Reject
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setTarget(chosen)
              setPicking(true)
            }}
          >
            Request review
          </Button>
          <Button size="sm" variant="ghost" onClick={clearChecked}>
            Clear selection
          </Button>
          {failed ? (
            <Text tone="failed" variant="small" role="alert">
              {failed.message}
            </Text>
          ) : null}
        </div>
      ) : null}
      <BulkRejectDialog
        open={rejecting}
        count={target.length}
        pending={bulk.isPending}
        reasonRequired={reasonRequired}
        onCancel={() => setRejecting(false)}
        onReject={(reason) => decide(target, 'rejected', reason)}
      />
      <MemberPicker
        workspace={workspace}
        project={project}
        open={picking}
        onOpenChange={setPicking}
        onPick={(member) =>
          bulkRequest.mutate(
            { buildIds: target.map((b) => b.id), reviewerIds: [member.id] },
            {
              onSuccess: (answer) => {
                toast.show(
                  withUndo(
                    `Asked ${member.name} to review ${countText(target.length)}`,
                    answer.undo,
                    { workspace, project: project ?? '' },
                    refreshAll(queryClient),
                    "Couldn't cancel the requests",
                  ),
                )
                if (target.some((b) => selected.has(b.id))) clearChecked()
              },
            },
          )
        }
      />
      <SaveViewDialog
        open={saving}
        filters={filters}
        pending={saveView.isPending}
        error={saveView.error?.message}
        onCancel={() => setSaving(false)}
        onSave={(name) =>
          saveView.mutate(
            { name, project, filters },
            {
              onSuccess: () => {
                setSaving(false)
                toast(`Saved view ${name}`)
              },
            },
          )
        }
      />
    </>
  )
}

export namespace BuildsBrowser {
  export interface Props {
    workspace: string
    /** The project whose builds to list; absent for every project of the workspace (a view with no project). */
    project?: string | undefined
    filters: BuildFilters
    onFiltersChange: (filters: BuildFilters) => void
    /** A project's page cursor (builds older than this number). */
    before?: number | undefined
    /** The workspace-wide page cursor (builds before this build id), and how to change it. */
    cursor?: string | undefined
    onCursorChange?: ((cursor: string | undefined) => void) | undefined
    /** Offer "Save view" (not on a saved view's own page). */
    canSave?: boolean
  }
}

/** A group's rows under its bar; an ungrouped list has no bar. */
function GroupRows({
  label,
  count,
  children,
}: {
  label: string
  count: number
  children: ReactNode
}) {
  const id = `builds-${label}`
  return (
    <section aria-labelledby={label ? id : undefined}>
      {label ? (
        <ListGroup
          id={id}
          level={2}
          label={label}
          count={count}
          countLabel={`${count} ${count === 1 ? 'build' : 'builds'}`}
        />
      ) : null}
      <ul aria-label={label || 'Builds'} className={styles.list}>
        {children}
      </ul>
    </section>
  )
}

/** A build in either list: a workspace-wide one also names its project. */
type Row = Build.ListItem & { project?: { slug: string; name: string } }

function RowMeta({ build, show }: { build: Row; show: DisplayOptions['show'] }) {
  return (
    <span className={styles.metaLine}>
      {build.project ? (
        <Text variant="small" tone="tertiary">
          {build.project.name}
        </Text>
      ) : null}
      {build.prNumber ? (
        <Text variant="small" tone="tertiary">
          PR #{build.prNumber}
        </Text>
      ) : null}
      {show.branch && build.branch ? (
        <Text variant="mono" tone="tertiary">
          {build.branch}
        </Text>
      ) : null}
      {show.branch ? (
        <Text variant="mono" tone="tertiary" title={build.commitSha}>
          {build.commitSha.slice(0, 7)}
        </Text>
      ) : null}
      {show.author && build.author ? (
        <Text variant="small" tone="tertiary">
          {build.author.name ?? build.author.login}
        </Text>
      ) : null}
      {show.date ? (
        <Text variant="small" tone="tertiary">
          <RelativeTime iso={build.createdAt} />
        </Text>
      ) : null}
    </span>
  )
}

function BuildPeek({ build: b }: { build: Build.ListItem }) {
  const state = buildState(b)
  return (
    <dl className={styles.peek}>
      <dt>State</dt>
      <dd>{state.label}</dd>
      {b.name !== 'default' ? (
        <>
          <dt>Name</dt>
          <dd>{b.name}</dd>
        </>
      ) : null}
      <dt>Branch</dt>
      <dd>{b.branch ?? (b.prNumber ? `PR #${b.prNumber}` : 'None')}</dd>
      <dt>Commit</dt>
      <dd>{b.commitSha.slice(0, 7)}</dd>
      {b.author ? (
        <>
          <dt>Author</dt>
          <dd>{b.author.name ?? b.author.login}</dd>
        </>
      ) : null}
      <dt>Screenshots</dt>
      <dd>
        {b.counts.changed} changed, {b.counts.added} added, {b.counts.removed} removed
        {b.counts.failed > 0 ? `, ${b.counts.failed} couldn't be read` : ''} of {b.counts.total}
      </dd>
      <dt>Uploaded</dt>
      <dd>
        <RelativeTime iso={b.createdAt} />
      </dd>
    </dl>
  )
}
