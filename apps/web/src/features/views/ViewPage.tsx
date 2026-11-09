import { EmptyState } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { parseFilters, type BuildFilters } from '#features/builds/list/builds-filters.ts'
import { BuildsBrowser } from '#features/builds/list/BuildsBrowser.tsx'
import { useCrumbNames } from '#features/teams/crumb-names.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'

import { findView, viewsQuery } from './api.ts'

import styles from '#features/teams/TeamPage.module.css'

/** A saved view: its team's builds list with the view's filters applied (editable for this visit only). */
export function ViewPage() {
  const { workspace, view: id } = useParams({ from: '/workspaces/$workspace/views/$view' })
  const query = useQuery(viewsQuery(workspace))
  const { data } = query
  const view = findView(data?.views, id)
  useDocumentTitle(view?.name ?? 'View')
  const names = useCrumbNames(workspace)

  return (
    <>
      <PageHeading crumbs={crumbsFor(names, [{ label: 'Views' }])} title={view?.name ?? '…'} />
      <div className={styles.content}>
        <QueryBoundary query={query} rows={4}>
          {() =>
            !view ? (
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
            )
          }
        </QueryBoundary>
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
