import type { Team } from '@circi/api'
import { useQuery } from '@tanstack/react-query'
import { Navigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { TEAM_SETTINGS_PAGES } from '#app/shell-model.ts'
import { useLoadingAnnouncement } from '#features/builds/list/loading.ts'
import { settingsQuery, teamsQuery } from '#features/teams/api/index.ts'
import { settingsCrumbsFor, teamsSettingsCrumb, workspaceSettingsCrumb } from '#lib/crumbs.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { PageFrame } from '#lib/PageFrame.tsx'
import { PageTitle } from '#lib/PageHeading.tsx'

import { TeamHeader } from './TeamHeader.tsx'

/**
 * What every team settings page shares: the breadcrumb (workspace, Settings, Teams, the team: see
 * `lib/crumbs.ts`), the team's header with its tabs, one column, the team's settings loaded once (the other pages read the same cache), its
 * loading and error states, and, for the pages only owners and admins may use, a redirect to the team's Members tab for everyone else (settings is a closed area: never out to the app)
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
  // The settings carry neither the workspace's name nor the member count, but the teams list (cached by the sidebar) does.
  const { data: overview } = useQuery(teamsQuery())
  const inWorkspace = overview?.teams.filter((p) => p.workspace.slug === workspace)
  const found = inWorkspace?.find((p) => p.team.slug === team)
  const workspaceName = inWorkspace?.[0]?.workspace.name ?? workspace
  const teamName = data?.settings.name ?? team
  // The tile follows the team's appearance; until the settings say, the default colour.
  const appearance: Partial<Team.Appearance> | undefined = data?.appearance
  useDocumentTitle(page, team)
  useLoadingAnnouncement(!data && !error, `Loading ${page.toLowerCase()}`)

  return (
    <PageFrame
      crumbs={settingsCrumbsFor({ slug: workspace, name: workspaceName }, [
        workspaceSettingsCrumb(workspace),
        teamsSettingsCrumb(workspace),
      ])}
      title={teamName}
      headingInPage
      header={
        <>
          <PageTitle>{page}</PageTitle>
          {data ? (
            <TeamHeader
              workspace={workspace}
              team={team}
              name={teamName}
              color={appearance?.color ?? 'slate'}
              icon={appearance?.icon ?? null}
              memberCount={found?.team.memberCount}
              canManage={data.canManage}
              active={TEAM_SETTINGS_PAGES.find((p) => p.label === page)?.key}
            />
          ) : null}
        </>
      }
      width={width}
      loading={!data}
      error={error}
      onRetry={() => void refetch()}
      notFound="This team doesn't exist"
      forbidden={
        managersOnly && data && !data.canManage ? (
          <Navigate to="/$workspace/$team/settings/members" params={{ workspace, team }} replace />
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
    /** Default: people who can't change the team's settings are sent to its Members tab. `false` for a page members may read. */
    managersOnly?: boolean
    children: (settings: Team.SettingsResponse, teamName: string) => ReactNode
  }
}
