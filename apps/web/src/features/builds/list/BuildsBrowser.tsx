import type { Build } from '@circi/api'
import {
  Button,
  CheckIcon,
  CollectionsIcon,
  EmptyState,
  ListRow,
  Pane,
  SectionHeader,
  StatusIcon,
  Surface,
  Text,
  useAnnounce,
  visuallyHidden,
} from '@circi/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

import { buildState } from '#features/builds/build-state.ts'
import { CountsSummary } from '#features/builds/CountsSummary.tsx'
import { shotReview } from '#features/builds/diff-status.ts'
import { MemberPicker } from '#features/reviews/MemberPicker.tsx'
import {
  BUILDS_PAGE_SIZE,
  teamQuery,
  useRejectReasonRequired,
  useBulkRequestReview,
  useBulkReview,
  workspaceBuildsQuery,
} from '#features/teams/api/index.ts'
import { useSaveView, viewsQuery, viewWithFilters } from '#features/views/api.ts'
import { SaveViewDialog } from '#features/views/SaveViewDialog.tsx'
import { NoMatches } from '#lib/FindField.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { useShortcutHandlers } from '#lib/shortcuts.ts'
import { useDisplayStore } from '#lib/stores/display-store.ts'
import { useListStore } from '#lib/stores/list-store.ts'
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
 * A team's builds: filter chips, display options, grouped rows with J / K, X to select, Space
 * to peek, and a bulk bar once something is selected. The filters belong to the page (the URL on
 * the team page, a saved view's on its own), so they come in as props.
 */
export function BuildsBrowser({
  workspace,
  team,
  filters,
  onFiltersChange,
  before,
  cursor: pageCursor,
  onCursorChange,
  canSave = true,
}: BuildsBrowser.Props) {
  const clientLink = useClientLink()
  const announce = useAnnounce()
  // Without a team this is the whole workspace's list (a saved view with no team).
  const scoped = team !== undefined
  // The server orders the list (and pages it in that order); grouping happens on the page.
  const display = useDisplayStore((s) => s.display)
  // The list stays on screen while the next one loads, so the find field under typing is not remounted.
  const teamResult = useQuery({
    ...teamQuery(workspace, team ?? '', before, filters, display.order),
    enabled: scoped,
    placeholderData: keepPreviousData,
  })
  const workspaceResult = useQuery({
    ...workspaceBuildsQuery(workspace, pageCursor, filters, display.order),
    enabled: !scoped,
    placeholderData: keepPreviousData,
  })
  const query = scoped ? teamResult : workspaceResult
  const { data } = query
  const teamOf = (b: Row) => b.team?.slug ?? team ?? ''

  const setDisplay = useDisplayStore((s) => s.setDisplay)
  const clearChecked = useListStore((s) => s.clearChecked)
  const [open, setOpen] = useState<FilterField | 'display'>()
  const selected = useListStore((s) => s.checked)
  const [rejecting, setRejecting] = useState(false)
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)

  // Bulk decisions are one team's (a single transaction); a workspace-wide list only browses.
  const bulk = useBulkReview(workspace, team ?? '')
  const reasonRequired = useRejectReasonRequired(workspace, team ?? '')
  const bulkRequest = useBulkRequestReview(workspace, team ?? '')
  const saveView = useSaveView(workspace)
  const views = useQuery({ ...viewsQuery(workspace), enabled: canSave })

  const builds: readonly Row[] = data?.builds ?? []
  const oldest = builds.at(-1)?.number
  const groups = groupBuilds(builds, display.groupBy)
  const flat = groups.flatMap((g) => g.builds)
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

  const decide = (decision: 'approved' | 'rejected', reason?: string) =>
    bulk.mutate(
      { buildIds: chosen.map((b) => b.id), decision, ...(reason ? { reason } : {}) },
      {
        onSuccess: () => {
          announce(
            `${decision === 'approved' ? 'Approved' : 'Rejected'} ${countText(chosen.length)}`,
          )
          clearChecked()
          setRejecting(false)
        },
      },
    )

  const failed = bulk.error ?? bulkRequest.error
  const title = before ? 'Older builds' : 'Builds'

  return (
    <>
      <SectionHeader title={title} />
      {data && (builds.length > 0 || filtered) ? (
        <BuildFilterBar
          workspace={workspace}
          team={team}
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
          savedAs={viewWithFilters(views.data?.views, team, filters)?.name}
        />
      ) : null}
      <QueryBoundary<NonNullable<typeof data>>
        query={query}
        announce="Loading builds"
        notFound={scoped ? "This team doesn't exist" : "This workspace doesn't exist"}
      >
        {() =>
          builds.length === 0 ? (
            filtered && Object.keys(parseFilters({ ...filters })).join() === 'q' ? (
              <NoMatches noun="builds" query={filters.q ?? ''} />
            ) : filtered ? (
              <EmptyState
                icon={<CollectionsIcon size={32} />}
                title="No builds match"
                action={<Button onClick={() => onFiltersChange({})}>Clear filters</Button>}
              >
                {scoped
                  ? 'Nothing in this team fits these filters.'
                  : 'Nothing in this workspace fits these filters.'}
              </EmptyState>
            ) : (
              <EmptyState
                icon={<CollectionsIcon size={32} />}
                title={before ? 'No older builds' : 'No builds yet'}
                action={
                  before ? undefined : (
                    <Surface variant="raised" className={styles.command}>
                      <Text as="code" variant="mono">
                        {`CIRCI_TOKEN=… CIRCI_API_URL=${window.location.origin} \\\n  npx circi upload ./screenshots --wait`}
                      </Text>
                    </Surface>
                  )
                }
              >
                {before
                  ? undefined
                  : "Upload screenshots from your CI job. Builds appear here as soon as they're processed."}
              </EmptyState>
            )
          ) : (
            <>
              <div className={styles.split}>
                <ul aria-label="Builds" className={styles.list} ref={listRef}>
                  {groups.map((group) => (
                    <GroupRows key={group.key} label={group.label} count={group.builds.length}>
                      {group.builds.map((b) => {
                        const state = buildState(b)
                        const checked = selected.has(b.id)
                        return (
                          <li
                            key={b.id}
                            {...rowProps(b.id)}
                            data-checked={checked ? '' : undefined}
                          >
                            <ListRow
                              className={styles.row}
                              selected={b.id === cursor?.id}
                              {...clientLink({
                                to: '/$workspace/$team/builds/$number',
                                params: { workspace, team: teamOf(b), number: String(b.number) },
                              })}
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
                            >
                              <span className={styles.title}>
                                {checked ? <span style={visuallyHidden}>Selected, </span> : null}
                                Build #{b.number}
                                {b.name !== 'default' ? (
                                  <span className={styles.name}> · {b.name}</span>
                                ) : null}
                              </span>
                              <div className={styles.meta}>
                                <RowMeta build={b} show={display.show} />
                              </div>
                            </ListRow>
                          </li>
                        )
                      })}
                    </GroupRows>
                  ))}
                </ul>
                {peek && cursor ? (
                  <Pane
                    label="Preview"
                    context={`#${cursor.number}`}
                    actions={
                      <Button
                        size="sm"
                        variant="primary"
                        {...clientLink({
                          to: '/$workspace/$team/builds/$number',
                          params: {
                            workspace,
                            team: teamOf(cursor),
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
                ) : null}
              </div>
              {/* Primer: pagination sits directly below the collection it pages. */}
              <div className={styles.pager}>
                {scoped ? (
                  <>
                    {before ? (
                      <Button
                        {...clientLink({
                          to: '/$workspace/$team',
                          params: { workspace, team },
                          search: toSearch(filters),
                        })}
                      >
                        Newest builds
                      </Button>
                    ) : null}
                    {builds.length === BUILDS_PAGE_SIZE && oldest ? (
                      <Button
                        {...clientLink({
                          to: '/$workspace/$team',
                          params: { workspace, team },
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
            onClick={() => decide('approved')}
          >
            Approve
          </Button>
          <Button size="sm" onClick={() => setRejecting(true)}>
            Reject
          </Button>
          <Button size="sm" onClick={() => setPicking(true)}>
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
        count={chosen.length}
        pending={bulk.isPending}
        reasonRequired={reasonRequired}
        onCancel={() => setRejecting(false)}
        onReject={(reason) => decide('rejected', reason)}
      />
      <MemberPicker
        workspace={workspace}
        team={team}
        open={picking}
        onOpenChange={setPicking}
        onPick={(member) =>
          bulkRequest.mutate(
            { buildIds: chosen.map((b) => b.id), reviewerIds: [member.id] },
            {
              onSuccess: () => {
                announce(`Asked ${member.name} to review ${countText(chosen.length)}`)
                clearChecked()
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
            { name, team, filters },
            {
              onSuccess: () => {
                setSaving(false)
                announce(`Saved view ${name}`)
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
    /** The team whose builds to list; absent for every team of the workspace (a view with no team). */
    team?: string | undefined
    filters: BuildFilters
    onFiltersChange: (filters: BuildFilters) => void
    /** A team's page cursor (builds older than this number). */
    before?: number | undefined
    /** The workspace-wide page cursor (builds before this build id), and how to change it. */
    cursor?: string | undefined
    onCursorChange?: ((cursor: string | undefined) => void) | undefined
    /** Offer "Save view" (not on a saved view's own page). */
    canSave?: boolean
  }
}

/** A group's rows under its heading; an ungrouped list has no heading. */
function GroupRows({
  label,
  count,
  children,
}: {
  label: string
  count: number
  children: ReactNode
}) {
  return (
    <>
      {label ? (
        <li className={styles.group}>
          <h3 className={styles.groupTitle}>{label}</h3>
          <Text variant="small" tone="secondary">
            {count}
          </Text>
        </li>
      ) : null}
      {children}
    </>
  )
}

/** A build in either list: a workspace-wide one also names its team. */
type Row = Build.ListItem & { team?: { slug: string; name: string } }

function RowMeta({ build, show }: { build: Row; show: DisplayOptions['show'] }) {
  return (
    <span className={styles.metaLine}>
      {build.team ? (
        <Text variant="small" tone="secondary">
          {build.team.name}
        </Text>
      ) : null}
      {build.prNumber ? (
        <Text variant="small" tone="secondary">
          PR #{build.prNumber}
        </Text>
      ) : null}
      {show.branch && build.branch ? (
        <Text variant="mono" tone="secondary">
          {build.branch}
        </Text>
      ) : null}
      {show.branch ? (
        <Text variant="mono" tone="secondary" title={build.commitSha}>
          {build.commitSha.slice(0, 7)}
        </Text>
      ) : null}
      {show.author && build.author ? (
        <Text variant="small" tone="secondary">
          {build.author.name ?? build.author.login}
        </Text>
      ) : null}
      {show.date ? (
        <Text variant="small" tone="secondary">
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
        {b.counts.changed} changed, {b.counts.added} added, {b.counts.removed} removed,{' '}
        {b.counts.failed} failed of {b.counts.total}
      </dd>
      <dt>Uploaded</dt>
      <dd>
        <RelativeTime iso={b.createdAt} />
      </dd>
    </dl>
  )
}
