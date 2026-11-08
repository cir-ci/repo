import type { Build } from '@circi/api'
import {
  Button,
  CheckIcon,
  CollectionsIcon,
  Delayed,
  EmptyState,
  ListRow,
  ListSkeleton,
  Pane,
  SectionHeader,
  StatusIcon,
  Surface,
  Text,
  useAnnounce,
  visuallyHidden,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

import { ErrorState } from '../../lib/ErrorState.tsx'
import { leavesKeyToFocus } from '../../lib/list-keys.ts'
import { RelativeTime } from '../../lib/RelativeTime.tsx'
import { useShortcutHandlers } from '../../lib/shortcuts.ts'
import { useClientLink } from '../../lib/use-client-link.ts'
import { useListNavigation } from '../../lib/use-list-navigation.ts'
import { buildState } from '../builds/build-state.ts'
import { CountsSummary } from '../builds/CountsSummary.tsx'
import { shotReview } from '../builds/diff-status.ts'
import { MemberPicker } from '../reviews/MemberPicker.tsx'
import { useSaveView } from '../views/api.ts'
import { SaveViewDialog } from '../views/SaveViewDialog.tsx'
import { BUILDS_PAGE_SIZE, projectQuery, useBulkRequestReview, useBulkReview } from './api.ts'
import { BuildFilterBar } from './BuildFilterBar.tsx'
import { type BuildFilters, type FilterField, hasFilters, toSearch } from './builds-filters.ts'
import { BulkRejectDialog } from './BulkRejectDialog.tsx'
import {
  type DisplayOptions,
  groupBuilds,
  loadDisplay,
  orderBuilds,
  saveDisplay,
} from './display-options.ts'
import { useLoadingAnnouncement } from './loading.ts'

import styles from './BuildsBrowser.module.css'

const countText = (n: number) => `${n} ${n === 1 ? 'build' : 'builds'}`

/**
 * A project's builds: filter chips, display options, grouped rows with J / K, X to select, Space
 * to peek, and a bulk bar once something is selected. The filters belong to the page (the URL on
 * the project page, a saved view's on its own), so they come in as props.
 */
export function BuildsBrowser({
  org,
  project,
  filters,
  onFiltersChange,
  before,
  canSave = true,
}: BuildsBrowser.Props) {
  const clientLink = useClientLink()
  const announce = useAnnounce()
  const { data, error, refetch } = useQuery(projectQuery(org, project, before, filters))
  useLoadingAnnouncement(!data && !error, 'Loading builds')

  const [display, setDisplayState] = useState<DisplayOptions>(loadDisplay)
  const [open, setOpen] = useState<FilterField | 'display'>()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [cursorId, setCursorId] = useState<string>()
  const [peek, setPeek] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)

  const bulk = useBulkReview(org, project)
  const bulkRequest = useBulkRequestReview(org, project)
  const saveView = useSaveView(org)

  const setDisplay = (next: DisplayOptions) => {
    setDisplayState(next)
    saveDisplay(next)
  }

  const builds = data?.builds ?? []
  const oldest = builds.at(-1)?.number
  const groups = groupBuilds(orderBuilds(builds, display.order), display.groupBy)
  const flat = groups.flatMap((g) => g.builds)
  const cursor = flat.find((b) => b.id === cursorId) ?? flat[0]
  const chosen = flat.filter((b) => selected.has(b.id))
  const filtered = hasFilters(filters)

  const { listRef, rowProps } = useListNavigation({
    items: flat,
    getId: (b) => b.id,
    selectedId: cursor?.id,
    onSelect: (b) => setCursorId(b.id),
  })

  useShortcutHandlers({
    peek: (_action, event) => {
      if (leavesKeyToFocus(event) || !cursor) return false
      setPeek((p) => !p)
      return undefined
    },
    select: () => {
      if (!cursor) return
      const next = new Set(selected)
      const on = !next.has(cursor.id)
      if (on) next.add(cursor.id)
      else next.delete(cursor.id)
      setSelected(next)
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
          setSelected(new Set())
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
          filters={filters}
          onFiltersChange={onFiltersChange}
          display={display}
          onDisplayChange={setDisplay}
          open={open}
          onOpenChange={setOpen}
          onSaveView={canSave ? () => setSaving(true) : undefined}
        />
      ) : null}
      {error ? (
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          notFound="This project doesn’t exist"
        />
      ) : !data ? (
        <Delayed>
          <ListSkeleton />
        </Delayed>
      ) : builds.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<CollectionsIcon size={32} />}
            title="No builds match"
            action={<Button onClick={() => onFiltersChange({})}>Clear filters</Button>}
          >
            Nothing in this project fits these filters.
          </EmptyState>
        ) : (
          <EmptyState
            icon={<CollectionsIcon size={32} />}
            title={before ? 'No older builds' : 'No builds yet'}
            action={
              before ? undefined : (
                <Surface variant="raised" className={styles['command']}>
                  <Text as="code" variant="mono">
                    {`CIRCI_TOKEN=… CIRCI_API_URL=${window.location.origin} \\\n  npx circi upload ./screenshots --wait`}
                  </Text>
                </Surface>
              )
            }
          >
            {before
              ? undefined
              : 'Upload screenshots from your CI job. Builds appear here as soon as they’re processed.'}
          </EmptyState>
        )
      ) : (
        <>
          <div className={styles['split']}>
            <ul aria-label="Builds" className={styles['list']} ref={listRef}>
              {groups.map((group) => (
                <GroupRows key={group.key} label={group.label} count={group.builds.length}>
                  {group.builds.map((b) => {
                    const state = buildState(b)
                    const checked = selected.has(b.id)
                    return (
                      <li key={b.id} {...rowProps(b.id)} data-checked={checked ? '' : undefined}>
                        <ListRow
                          className={styles['row']}
                          selected={b.id === cursor?.id}
                          {...clientLink({
                            to: '/$org/$project/builds/$number',
                            params: { org, project, number: String(b.number) },
                          })}
                          leading={
                            <span className={styles['lead']}>
                              {checked ? (
                                <span className={styles['check']} aria-hidden="true">
                                  <CheckIcon size={12} strokeWidth={3} />
                                </span>
                              ) : null}
                              <StatusIcon status={state.status} label={state.label} />
                            </span>
                          }
                          trailing={
                            display.show.counts ? (
                              <span className={styles['trailing']}>
                                <CountsSummary
                                  counts={b.counts}
                                  review={shotReview(b)}
                                  includeUnchanged={false}
                                />
                              </span>
                            ) : undefined
                          }
                        >
                          <span className={styles['title']}>
                            {checked ? <span style={visuallyHidden}>Selected, </span> : null}
                            Build #{b.number}
                            {b.name !== 'default' ? (
                              <span className={styles['name']}> · {b.name}</span>
                            ) : null}
                          </span>
                          <div className={styles['meta']}>
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
                      to: '/$org/$project/builds/$number',
                      params: { org, project, number: String(cursor.number) },
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
          <div className={styles['pager']}>
            {before ? (
              <Button
                {...clientLink({
                  to: '/$org/$project',
                  params: { org, project },
                  search: toSearch(filters),
                })}
              >
                Newest builds
              </Button>
            ) : null}
            {builds.length === BUILDS_PAGE_SIZE && oldest ? (
              <Button
                {...clientLink({
                  to: '/$org/$project',
                  params: { org, project },
                  search: toSearch(filters, oldest),
                })}
              >
                Older builds
              </Button>
            ) : null}
          </div>
        </>
      )}
      {chosen.length > 0 ? (
        <div role="region" aria-label="Bulk actions" className={styles['bulk']}>
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
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
          {failed ? (
            <Text tone="rejected" variant="small" role="alert">
              {failed.message}
            </Text>
          ) : null}
        </div>
      ) : null}
      <BulkRejectDialog
        open={rejecting}
        count={chosen.length}
        pending={bulk.isPending}
        onCancel={() => setRejecting(false)}
        onReject={(reason) => decide('rejected', reason)}
      />
      <MemberPicker
        org={org}
        open={picking}
        onOpenChange={setPicking}
        onPick={(member) =>
          bulkRequest.mutate(
            { numbers: chosen.map((b) => b.number), reviewerId: member.id },
            {
              onSuccess: () => {
                announce(`Asked ${member.name} to review ${countText(chosen.length)}`)
                setSelected(new Set())
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
    org: string
    project: string
    filters: BuildFilters
    onFiltersChange: (filters: BuildFilters) => void
    /** The page cursor (builds older than this number). */
    before?: number | undefined
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
        <li className={styles['group']}>
          <h3 className={styles['groupTitle']}>{label}</h3>
          <Text variant="small" tone="secondary">
            {count}
          </Text>
        </li>
      ) : null}
      {children}
    </>
  )
}

function RowMeta({ build, show }: { build: Build.ListItem; show: DisplayOptions['show'] }) {
  return (
    <span className={styles['metaLine']}>
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
    <dl className={styles['peek']}>
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
