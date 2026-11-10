import { useQuery } from '@tanstack/react-query'
import { Navigate } from '@tanstack/react-router'

import { capabilitiesQuery, teamsQuery } from '#features/teams/api/index.ts'
import { PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'

import { NotFound } from './NotFound.tsx'
import { listWorkspaces, pickLandingWorkspace, readRememberedWorkspace } from './shell-model.ts'

const TITLES = { reviews: 'Reviews', insights: 'Insights' } as const

/**
 * A workspace page's address without its workspace (`/reviews`, `/insights`): goes to that page
 * in the workspace the account opened last (the server remembers it, so every device agrees),
 * else the one this browser chose, else the first. A workspace that is gone is skipped. The
 * capabilities (which carry the server's value) are normally cached by the shell already; if
 * they haven't arrived the redirect waits for them rather than land on the wrong workspace, and
 * if they fail it uses the browser's value.
 */
export function WorkspaceRedirect({ page }: WorkspaceRedirect.Props) {
  const teams = useQuery(teamsQuery())
  const caps = useQuery(capabilitiesQuery())
  return (
    <>
      {teams.data ? null : <PageHeading title={TITLES[page]} />}
      <QueryBoundary<NonNullable<typeof teams.data>>
        query={caps.isPending ? { ...teams, data: undefined } : teams}
        announce="Opening the page"
      >
        {(data) => {
          const workspace = pickLandingWorkspace(
            listWorkspaces(data.teams, caps.data?.manageableWorkspaces),
            caps.data?.lastWorkspace,
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
