import { Breadcrumbs, Delayed, EmptyState, ListSkeleton, PanelHeader } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { useDocumentTitle } from '../../lib/document-title.ts'
import { ErrorState } from '../../lib/ErrorState.tsx'
import { parseFilters, type BuildFilters } from '../projects/builds-filters.ts'
import { BuildsBrowser } from '../projects/BuildsBrowser.tsx'
import { findView, viewsQuery } from './api.ts'

import styles from '../projects/ProjectPage.module.css'

/** A saved view: its project's builds list with the view's filters applied (editable for this visit only). */
export function ViewPage() {
  const { org, view: id } = useParams({ from: '/organizations/$org/views/$view' })
  const { data, error, refetch } = useQuery(viewsQuery(org))
  const view = findView(data?.views, id)
  useDocumentTitle(view?.name ?? 'View')

  return (
    <>
      <PanelHeader>
        <Breadcrumbs items={[{ label: 'Views' }, { label: view?.name ?? '…' }]} />
      </PanelHeader>
      <div className={styles['content']}>
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
        ) : view.project ? (
          // Keyed by view, so opening another view starts from its own filters.
          <ViewBuilds
            key={view.id}
            org={org}
            project={view.project.slug}
            filters={parseFilters({ ...view.filters })}
          />
        ) : (
          <EmptyState title={view.name}>
            This view spans the whole organization, which the builds list can’t show yet.
          </EmptyState>
        )}
      </div>
    </>
  )
}

function ViewBuilds({
  org,
  project,
  filters: initial,
}: {
  org: string
  project: string
  filters: BuildFilters
}) {
  const [filters, setFilters] = useState(initial)
  return (
    <BuildsBrowser
      org={org}
      project={project}
      filters={filters}
      onFiltersChange={setFilters}
      canSave={false}
    />
  )
}
