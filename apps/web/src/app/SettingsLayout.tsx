import { NavSection } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { capabilitiesQuery, teamsQuery } from '#features/teams/api.ts'

import { NavLink } from './NavLink.tsx'
import { listWorkspaces, pickWorkspace, readRememberedWorkspace } from './shell-model.ts'

import styles from './SettingsLayout.module.css'

/**
 * The frame of every settings page: one nav with three sections (Account, Workspace, Team)
 * beside the page. The workspace is the one in the address, else the last chosen; the Team
 * section shows only on a team's pages.
 */
export function SettingsLayout({ children }: SettingsLayout.Props) {
  const params = useParams({ strict: false })
  const { data: overview } = useQuery(teamsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const workspaces = listWorkspaces(overview?.teams, caps?.manageableWorkspaces, params.workspace)
  const workspace = pickWorkspace(workspaces, params.workspace, readRememberedWorkspace())
  const team = params.team

  return (
    <div className={styles.root}>
      <nav aria-label="Settings" className={styles.nav}>
        <NavSection label="Account">
          <NavLink to="/account">Profile</NavLink>
          <NavLink to="/account/notifications">Notifications</NavLink>
          <NavLink to="/account/appearance">Appearance</NavLink>
        </NavSection>
        {workspace ? (
          <NavSection label={`Workspace · ${workspace.name}`}>
            <NavLink to="/workspaces/$workspace/settings" params={{ workspace: workspace.slug }}>
              General
            </NavLink>
            <NavLink
              to="/workspaces/$workspace/settings/members"
              params={{ workspace: workspace.slug }}
            >
              Members
            </NavLink>
            <NavLink
              to="/workspaces/$workspace/settings/integrations"
              params={{ workspace: workspace.slug }}
            >
              Integrations
            </NavLink>
            <NavLink
              to="/workspaces/$workspace/settings/storage"
              params={{ workspace: workspace.slug }}
            >
              Storage
            </NavLink>
          </NavSection>
        ) : null}
        {workspace && team ? (
          <NavSection label={`Team · ${team}`}>
            <NavLink
              to="/$workspace/$team/settings/reviews"
              params={{ workspace: workspace.slug, team }}
            >
              Reviews and triage
            </NavLink>
            <NavLink to="/$workspace/$team/settings" params={{ workspace: workspace.slug, team }}>
              General
            </NavLink>
          </NavSection>
        ) : null}
      </nav>
      <div className={styles.page}>{children}</div>
    </div>
  )
}

export namespace SettingsLayout {
  export interface Props {
    children: ReactNode
  }
}
