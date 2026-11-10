import { useParams } from '@tanstack/react-router'

import { TeamSitesBody } from '#features/sites/TeamSitesPage.tsx'

import { TeamSettingsFrame } from './TeamSettingsFrame.tsx'

/** Team settings, Sites: the team's hosted sites, in the settings frame. */
export function TeamSitesSettingsPage() {
  const { workspace, team } = useParams({ from: '/$workspace/$team/settings/sites' })
  return (
    <TeamSettingsFrame workspace={workspace} team={team} page="Sites">
      {() => <TeamSitesBody workspace={workspace} team={team} />}
    </TeamSettingsFrame>
  )
}
