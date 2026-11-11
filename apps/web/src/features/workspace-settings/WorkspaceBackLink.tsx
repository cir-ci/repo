import { useQuery } from '@tanstack/react-query'

import { SettingsBackLink } from '#features/team-settings/SettingsBackLink.tsx'
import { capabilitiesQuery } from '#features/teams/api/index.ts'

import styles from './WorkspaceBackLink.module.css'

/**
 * "‹ <Workspace>" at the top of a workspace settings page, to the workspace's hub. Only instance
 * admins have a hub; everyone else has the sidebar's Workspace section and no way up.
 */
export function WorkspaceBackLink({ workspace, name }: WorkspaceBackLink.Props) {
  const { data: caps } = useQuery(capabilitiesQuery())
  if (!caps?.instanceAdmin) return null
  return (
    <div className={styles.root}>
      <SettingsBackLink
        label={name}
        link={{ to: '/workspaces/$workspace/settings', params: { workspace } }}
      />
    </div>
  )
}

export namespace WorkspaceBackLink {
  export interface Props {
    workspace: string
    /** The workspace's display name. */
    name: string
  }
}
