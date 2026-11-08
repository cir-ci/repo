import { Breadcrumbs, Delayed, EmptyState, ListSkeleton, PanelHeader } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { parseFilters, type BuildFilters } from '#features/teams/builds-filters.ts'
import { BuildsBrowser } from '#features/teams/BuildsBrowser.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { ErrorState } from '#lib/ErrorState.tsx'

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
      <PanelHeader>
        <Breadcrumbs items={[{ label: 'Views' }, { label: view?.name ?? '…' }]} />
      </PanelHeader>
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
          <EmptyState title={view.name}>
            This view spans the whole workspace, which the builds list can’t show yet.
          </EmptyState>
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
  team: string
  filters: BuildFilters
}) {
  const [filters, setFilters] = useState(initial)
  return (
    <BuildsBrowser
      workspace={workspace}
      team={team}
      filters={filters}
      onFiltersChange={setFilters}
      canSave={false}
    />
  )
}
