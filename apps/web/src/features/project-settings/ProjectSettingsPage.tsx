import { useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { GitAttentionBanner } from '#features/builds/list/GitAttentionBanner.tsx'
import { useSaveSettings } from '#features/projects/api/index.ts'
import { DeleteProjectSection } from '#features/projects/DeleteProjectSection.tsx'
import { ProjectIdentity } from '#features/projects/ProjectIdentity.tsx'

import { ProjectSettingsFrame } from './ProjectSettingsFrame.tsx'
import { SettingsForm } from './SettingsForm.tsx'

/** A project's General settings. Owners and admins edit; members look. */
export function ProjectSettingsPage() {
  const { workspace, project } = useParams({ from: '/$workspace/$project/settings/general' })
  const save = useSaveSettings(workspace, project)
  const [saved, setSaved] = useState(false)
  return (
    <ProjectSettingsFrame workspace={workspace} project={project} page="General">
      {(data, name) => (
        <>
          <GitAttentionBanner attention={data.github.link?.attention} />
          <ProjectIdentity
            workspace={workspace}
            project={project}
            name={name}
            slug={data.settings.slug}
            defaultBranch={data.settings.defaultBranch}
            appearance={data.appearance}
            canManage={data.canManage}
          />
          <SettingsForm
            // A fresh form whenever the saved values change, so it never shows stale input. The
            // name, address and default branch save by themselves above and are not in this form,
            // so they must not reset it.
            key={JSON.stringify({
              ...data.settings,
              name: undefined,
              slug: undefined,
              defaultBranch: undefined,
            })}
            workspace={workspace}
            project={project}
            settings={data.settings}
            canManage={data.canManage}
            link={data.github.link}
            workspaceFlakyBlocksMerge={data.workspace.flakyBlocksMerge}
            sitesConfigured={data.sitesConfigured}
            save={save}
            saved={saved}
            onSavedChange={setSaved}
          />
          <DeleteProjectSection
            workspace={workspace}
            project={project}
            name={name}
            canManage={data.canManage}
          />
        </>
      )}
    </ProjectSettingsFrame>
  )
}
