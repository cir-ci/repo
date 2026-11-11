import type { Team } from '@circi/api'
import { Avatar, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Navigate, type NavigateOptions } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { useLoadingAnnouncement } from '#features/builds/list/loading.ts'
import { settingsQuery, teamsQuery } from '#features/teams/api/index.ts'
import { memberCountLabel } from '#features/teams/AvatarStack.tsx'
import {
  settingsCrumbsFor,
  teamSettingsCrumb,
  teamsSettingsCrumb,
  workspaceSettingsCrumb,
} from '#lib/crumbs.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { PageFrame } from '#lib/PageFrame.tsx'

import { SettingsBackLink } from './SettingsBackLink.tsx'

import styles from './TeamSettingsHub.module.css'

/**
 * What every team settings page shares: the breadcrumb (Workspace, Settings, Teams, the team, the
 * page: see `lib/crumbs.ts`), one column that starts with a way back ("Teams" on the hub, the
 * team's name on a page), the team's settings loaded once (the other pages read the same cache),
 * its loading and error states, and, for the pages only owners and admins may use, a redirect to
 * the team's settings hub for everyone else (settings is a closed area: never out to the app)
 * (`managersOnly={false}` keeps a page that members may read).
 *
 * Without a `page` it is the team's hub (`TeamSettingsHubPage`): the team's name is its title, with
 * its tile and member count above the rows.
 */
export function TeamSettingsFrame({
  workspace,
  team,
  page,
  width = 'default',
  managersOnly = true,
  back,
  find,
  actions,
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
  useDocumentTitle(page ?? teamName, page ? team : undefined)
  useLoadingAnnouncement(!data && !error, `Loading ${(page ?? teamName).toLowerCase()}`)

  return (
    <PageFrame
      crumbs={settingsCrumbsFor({ slug: workspace, name: workspaceName }, [
        workspaceSettingsCrumb(workspace),
        teamsSettingsCrumb(workspace),
        ...(page ? [teamSettingsCrumb(workspace, team, teamName)] : []),
      ])}
      title={page ?? teamName}
      {...(find ? { find } : {})}
      {...(actions ? { actions } : {})}
      width={width}
      loading={!data}
      error={error}
      onRetry={() => void refetch()}
      notFound="This team doesn't exist"
      forbidden={
        managersOnly && data && !data.canManage ? (
          <Navigate to="/$workspace/$team/settings" params={{ workspace, team }} replace />
        ) : null
      }
    >
      {data ? (
        <>
          <div className={styles.head}>
            {page ? (
              <SettingsBackLink
                label={back?.label ?? teamName}
                link={
                  back?.link ?? { to: '/$workspace/$team/settings', params: { workspace, team } }
                }
              />
            ) : (
              <>
                <SettingsBackLink
                  label="Teams"
                  link={{ to: '/workspaces/$workspace/settings/teams', params: { workspace } }}
                />
                <div className={styles.identity}>
                  <Avatar
                    type="team"
                    aria-hidden
                    slug={team}
                    name={teamName}
                    color={appearance?.color ?? 'slate'}
                    icon={appearance?.icon ?? null}
                    size={40}
                  />
                  <div className={styles.names}>
                    <span className={styles.name}>{teamName}</span>
                    {found ? (
                      <Text tone="tertiary" variant="small">
                        {memberCountLabel(found.team.memberCount)}
                      </Text>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </div>
          {children(data, teamName)}
        </>
      ) : null}
    </PageFrame>
  )
}

export namespace TeamSettingsFrame {
  export interface Props {
    workspace: string
    team: string
    /** This page's name: its title and the last crumb. Without one the frame is the team's hub, titled with the team's name. */
    page?: string
    /** The column's width: 720 by default, 1040 for the ignore regions workbench. */
    width?: 'default' | 'wide'
    /** Default: people who can't change the team's settings are sent to its settings hub. `false` for a page members may read. */
    managersOnly?: boolean
    /** A page one level below another settings page (an ignore region's screenshot) goes back to that page instead of the hub. */
    back?: { label: string; link: NavigateOptions }
    /** The page's find field and main button, in the header bar. */
    find?: ReactNode
    actions?: ReactNode
    children: (settings: Team.SettingsResponse, teamName: string) => ReactNode
  }
}
