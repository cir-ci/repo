import { useParams } from '@tanstack/react-router'

import { ProjectSitesBody } from '#features/sites/ProjectSitesPage.tsx'

import { ProjectSettingsFrame } from './ProjectSettingsFrame.tsx'

/** Project settings, Sites: the project's hosted sites, in the settings frame. */
export function ProjectSitesSettingsPage() {
  const { workspace, project } = useParams({ from: '/$workspace/$project/settings/sites' })
  return (
    <ProjectSettingsFrame workspace={workspace} project={project} page="Sites">
      {() => <ProjectSitesBody workspace={workspace} project={project} />}
    </ProjectSettingsFrame>
  )
}
