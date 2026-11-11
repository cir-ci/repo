import { useParams } from '@tanstack/react-router'

import { BaselineBody } from '#features/baselines/BaselinePage.tsx'
import { ProjectSettingsFrame } from '#features/project-settings/ProjectSettingsFrame.tsx'

import { BASELINE_ROUTE } from './routes.ts'

/**
 * Project settings, Ignore regions, one screenshot: the baseline page's body in the settings frame,
 * so the overview never leads out of settings.
 */
export function IgnoreRegionBaselinePage() {
  const { workspace, project, _splat } = useParams({
    from: BASELINE_ROUTE,
  })
  return (
    <ProjectSettingsFrame
      workspace={workspace}
      project={project}
      page="Ignore regions"
      width="wide"
      managersOnly={false}
      back={{
        label: 'Ignore regions',
        link: {
          to: '/$workspace/$project/settings/ignore-regions',
          params: { workspace, project },
        },
      }}
    >
      {() => (
        <BaselineBody workspace={workspace} project={project} name={_splat ?? ''} inSettings />
      )}
    </ProjectSettingsFrame>
  )
}
