import { Delayed, EmptyState, ListSkeleton } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { parseFilters, type BuildFilters } from '#features/teams/builds-filters.ts'
import { BuildsBrowser } from '#features/teams/BuildsBrowser.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { PageHeading } from '#lib/PageHeading.tsx'

import { findView, viewsQuery } from './api.ts'

import styles from '#features/teams/TeamPage.module.css'

/** A saved view: its team's builds list with the view's filters applied (editable for this visit only). */
export function ViewPage() {
  const { workspace, view: id } = useParams({ from: '/workspaces/$workspace/views/$view' })
  const { data, error, refetch } = useQuery(viewsQuery(workspace))
  const view = findView(data?.views, id)
  useDocumentTitle(view?.name ?? 'View')

  return (
    <>
      <PageHeading crumbs={[{ label: 'Views' }]} title={view?.name ?? '…'} />
      <div className={styles.content}>
        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !data ? (
          <Delayed>
            <ListSkeleton rows={4} />
          </Delayed>
        ) : !view ? (
          <EmptyState title="This view doesn’t exist">
            It may have been deleted, or it belongs to someone else.
          </EmptyState>
        ) : view.team ? (
          // Keyed by view, so opening another view starts from its own filters.
          <ViewBuilds
            key={view.id}
            workspace={workspace}
            team={view.team.slug}
            filters={parseFilters({ ...view.filters })}
          />
        ) : (
          <ViewBuilds
            key={view.id}
            workspace={workspace}
            filters={parseFilters({ ...view.filters })}
          />
        )}
      </div>
    </>
  )
}

function ViewBuilds({
  workspace,
  team,
  filters: initial,
}: {
  workspace: string
  /** Absent for a view across the whole workspace. */
  team?: string
  filters: BuildFilters
}) {
  const [filters, setFilters] = useState(initial)
  // A workspace-wide list pages by a build id kept here; a team's pages by number, in its URL.
  const [cursor, setCursor] = useState<string>()
  return (
    <BuildsBrowser
      workspace={workspace}
      team={team}
      filters={filters}
      onFiltersChange={(next) => {
        setFilters(next)
        setCursor(undefined)
      }}
      cursor={cursor}
      onCursorChange={setCursor}
      canSave={false}
    />
  )
}
