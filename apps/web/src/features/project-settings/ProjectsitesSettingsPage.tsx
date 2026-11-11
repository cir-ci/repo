import { useParams } from '@tanstack/react-router'

import { ProjectsitesBody } from '#features/sites/ProjectsitesPage.tsx'

import { ProjectsettingsFrame } from './ProjectsettingsFrame.tsx'

/** Project settings, Sites: the project's hosted sites, in the settings frame. */
export function ProjectsitesSettingsPage() {
  const { workspace, project } = useParams({ from: '/$workspace/$project/settings/sites' })
  return (
    <ProjectsettingsFrame workspace={workspace} project={project} page="Sites">
      {() => <ProjectsitesBody workspace={workspace} project={project} />}
    </ProjectsettingsFrame>
  )
}
