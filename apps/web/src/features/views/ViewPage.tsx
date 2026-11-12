import { EmptyState } from '@circi/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useState } from 'react'

import {
  hasFilters,
  parseFilters,
  type BuildFilters,
} from '#features/builds/list/builds-filters.ts'
import { BuildsBrowser } from '#features/builds/list/BuildsBrowser.tsx'
import { BuildsFind } from '#features/builds/list/BuildsFind.tsx'
import { projectQuery, workspaceBuildsQuery } from '#features/projects/api/index.ts'
import { useCrumbNames } from '#features/projects/crumb-names.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { useDisplayStore } from '#lib/stores/display-store.ts'

import { findView, viewsQuery } from './api.ts'

import styles from '#features/projects/ProjectPage.module.css'

/** A saved view: its project's builds list with the view's filters applied (editable for this visit only). */
export function ViewPage() {
  const { workspace, view: id } = useParams({ from: '/workspaces/$workspace/views/$view' })
  const query = useQuery(viewsQuery(workspace))
  const { data } = query
  const view = findView(data?.views, id)
  useDocumentTitle(view?.name ?? 'View')
  const names = useCrumbNames(workspace)
  const crumbs = crumbsFor(names, [{ label: 'Views' }])

  return (
    <>
      {/* Once the view is known, its builds list brings the header (it owns the find field's filters). */}
      {view ? null : <PageHeading crumbs={crumbs} title="…" />}
      <QueryBoundary query={query} rows={4}>
        {() =>
          !view ? (
            <div className={styles.content}>
              <EmptyState title="This view doesn't exist">
                It may have been deleted, or it belongs to someone else.
              </EmptyState>
            </div>
          ) : (
            // Keyed by view, so opening another view starts from its own filters.
            <ViewBuilds
              key={view.id}
              workspace={workspace}
              crumbs={crumbs}
              title={view.name}
              {...(view.project ? { project: view.project.slug } : {})}
              filters={parseFilters({ ...view.filters })}
            />
          )
        }
      </QueryBoundary>
    </>
  )
}

function ViewBuilds({
  workspace,
  project,
  crumbs,
  title,
  filters: initial,
}: {
  workspace: string
  /** Absent for a view across the whole workspace. */
  project?: string
  crumbs: ReadonlyArray<PageHeading.Crumb>
  title: string
  filters: BuildFilters
}) {
  const [filters, setFilters] = useState(initial)
  // A workspace-wide list pages by a build id kept here; a project's pages by number, in its URL.
  const [cursor, setCursor] = useState<string>()
  const order = useDisplayStore((s) => s.display.order)
  // The same queries as the list's own, so the page header knows whether there is anything to find.
  const scoped = project !== undefined
  const projectResult = useQuery({
    ...projectQuery(workspace, project ?? '', undefined, filters, order),
    enabled: scoped,
    placeholderData: keepPreviousData,
  })
  const workspaceResult = useQuery({
    ...workspaceBuildsQuery(workspace, cursor, filters, order),
    enabled: !scoped,
    placeholderData: keepPreviousData,
  })
  const builds = (scoped ? projectResult : workspaceResult).data?.builds ?? []
  const change = (next: BuildFilters) => {
    setFilters(next)
    setCursor(undefined)
  }
  return (
    <>
      <PageHeading
        crumbs={crumbs}
        title={title}
        find={
          <BuildsFind
            filters={filters}
            onFiltersChange={change}
            disabled={builds.length === 0 && !hasFilters(filters)}
          />
        }
      />
      <div className={styles.content}>
        <BuildsBrowser
          workspace={workspace}
          project={project}
          filters={filters}
          onFiltersChange={change}
          cursor={cursor}
          onCursorChange={setCursor}
          canSave={false}
        />
      </div>
    </>
  )
}
