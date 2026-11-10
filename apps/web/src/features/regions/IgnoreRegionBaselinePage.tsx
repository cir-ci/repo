import { useParams } from '@tanstack/react-router'

import { BaselineBody } from '#features/baselines/BaselinePage.tsx'
import { TeamSettingsFrame } from '#features/team-settings/TeamSettingsFrame.tsx'

import { BASELINE_ROUTE } from './routes.ts'

/**
 * Team settings, Ignore regions, one screenshot: the baseline page's body in the settings frame,
 * so the overview never leads out of settings.
 */
export function IgnoreRegionBaselinePage() {
  const { workspace, team, _splat } = useParams({
    from: BASELINE_ROUTE,
  })
  return (
    <TeamSettingsFrame
      workspace={workspace}
      team={team}
      page="Ignore regions"
      width="wide"
      managersOnly={false}
    >
      {() => <BaselineBody workspace={workspace} team={team} name={_splat ?? ''} inSettings />}
    </TeamSettingsFrame>
  )
}
