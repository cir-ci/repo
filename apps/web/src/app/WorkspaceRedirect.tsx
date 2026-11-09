import { useQuery } from '@tanstack/react-query'
import { Navigate } from '@tanstack/react-router'

import { capabilitiesQuery, teamsQuery } from '#features/teams/api/index.ts'
import { PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'

import { NotFound } from './NotFound.tsx'
import { listWorkspaces, pickWorkspace, readRememberedWorkspace } from './shell-model.ts'

const TITLES = { reviews: 'Reviews', insights: 'Insights' } as const

/**
 * A workspace page's address without its workspace (`/reviews`, `/insights`): goes to that page
 * in the workspace chosen last time, else the first one, like the sidebar picks. A person with
 * no workspace gets the 404 page.
 */
export function WorkspaceRedirect({ page }: WorkspaceRedirect.Props) {
  const teams = useQuery(teamsQuery())
  const caps = useQuery(capabilitiesQuery())
  return (
    <>
      {teams.data ? null : <PageHeading title={TITLES[page]} />}
      <QueryBoundary<NonNullable<typeof teams.data>> query={teams} announce="Opening the page">
        {(data) => {
          const workspace = pickWorkspace(
            listWorkspaces(data.teams, caps.data?.manageableWorkspaces),
            undefined,
            readRememberedWorkspace(),
          )
          if (!workspace) return <NotFound />
          const params = { workspace: workspace.slug }
          // Each page's own search defaults, so the address ends up as if opened from the sidebar.
          return page === 'reviews' ? (
            <Navigate
              to="/workspaces/$workspace/reviews"
              params={params}
              search={{ tab: 'for-you' }}
              replace
            />
          ) : (
            <Navigate
              to="/workspaces/$workspace/insights"
              params={params}
              search={{ range: 30 }}
              replace
            />
          )
        }}
      </QueryBoundary>
    </>
  )
}

export namespace WorkspaceRedirect {
  export interface Props {
    page: 'reviews' | 'insights'
  }
}
