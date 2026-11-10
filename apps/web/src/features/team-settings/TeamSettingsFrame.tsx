import type { Team } from '@circi/api'
import { useQuery } from '@tanstack/react-query'
import { Navigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { useLoadingAnnouncement } from '#features/builds/list/loading.ts'
import { settingsQuery, teamsQuery } from '#features/teams/api/index.ts'
import { crumbsFor, teamSettingsCrumb } from '#lib/crumbs.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { PageFrame } from '#lib/PageFrame.tsx'

/**
 * What every team settings page shares: the breadcrumb (workspace, team, Settings, this page: see
 * `lib/crumbs.ts`), one column, the team's settings loaded once (the other pages read the same cache), its
 * loading and error states, and, for the pages only owners and admins may use, a redirect to the team's builds for everyone else
 * (`managersOnly={false}` keeps a page that members may read).
 */
export function TeamSettingsFrame({
  workspace,
  team,
  page,
  width = 'default',
  managersOnly = true,
  children,
}: TeamSettingsFrame.Props) {
  const { data, error, refetch } = useQuery(settingsQuery(workspace, team))
  // The settings don't carry the workspace's name, but the teams list (cached by the sidebar) does.
  const { data: overview } = useQuery(teamsQuery())
  const found = overview?.teams.find((p) => p.workspace.slug === workspace)
  const workspaceName = found?.workspace.name ?? workspace
  const teamName = data?.settings.name ?? team
  useDocumentTitle(page, team)
  useLoadingAnnouncement(!data && !error, `Loading ${page.toLowerCase()}`)

  return (
    <PageFrame
      crumbs={crumbsFor(
        {
          workspace: { slug: workspace, name: workspaceName },
          team: { slug: team, name: teamName },
        },
        page === 'Settings' ? [] : [teamSettingsCrumb(workspace, team)],
      )}
      title={page}
      width={width}
      loading={!data}
      error={error}
      onRetry={() => void refetch()}
      notFound="This team doesn’t exist"
      forbidden={
        managersOnly && data && !data.canManage ? (
          <Navigate to="/$workspace/$team" params={{ workspace, team }} replace />
        ) : null
      }
    >
      {data ? children(data, teamName) : null}
    </PageFrame>
  )
}

export namespace TeamSettingsFrame {
  export interface Props {
    workspace: string
    team: string
    /** This page's name: the last crumb and the start of the tab title. */
    page: string
    /** The column's width: 720 by default, 1040 for the ignore regions workbench. */
    width?: 'default' | 'wide'
    /** Default: people who can't change the team's settings are sent to its builds. `false` for a page members may read. */
    managersOnly?: boolean
    children: (settings: Team.SettingsResponse, teamName: string) => ReactNode
  }
}
