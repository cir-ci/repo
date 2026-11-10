import { useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { GitAttentionBanner } from '#features/builds/list/GitAttentionBanner.tsx'
import { useSaveSettings } from '#features/teams/api/index.ts'
import { AppearanceSection } from '#features/teams/AppearanceSection.tsx'
import { DeleteTeamSection } from '#features/teams/DeleteTeamSection.tsx'

import { SettingsForm } from './SettingsForm.tsx'
import { TeamSettingsFrame } from './TeamSettingsFrame.tsx'

/** A team's General settings. Owners and admins edit; members look. */
export function TeamSettingsPage() {
  const { workspace, team } = useParams({ from: '/$workspace/$team/settings' })
  const save = useSaveSettings(workspace, team)
  const [saved, setSaved] = useState(false)
  const navigate = useNavigate()
  return (
    <TeamSettingsFrame workspace={workspace} team={team} page="General">
      {(data, name) => (
        <>
          <GitAttentionBanner attention={data.github.link?.attention} />
          <AppearanceSection
            workspace={workspace}
            team={team}
            name={name}
            appearance={data.appearance}
            canManage={data.canManage}
          />
          <SettingsForm
            // A fresh form whenever the saved values change, so it never shows stale input. The
            // name saves by itself above and is not in this form, so it must not reset it.
            key={JSON.stringify({ ...data.settings, name: undefined })}
            workspace={workspace}
            team={team}
            settings={data.settings}
            canManage={data.canManage}
            link={data.github.link}
            workspaceFlakyBlocksMerge={data.workspace.flakyBlocksMerge}
            sitesConfigured={data.sitesConfigured}
            save={save}
            saved={saved}
            onSavedChange={setSaved}
            onRenamed={(slug) =>
              void navigate({
                to: '/$workspace/$team/settings',
                params: { workspace, team: slug },
                replace: true,
              })
            }
          />
          <DeleteTeamSection
            workspace={workspace}
            team={team}
            name={name}
            canManage={data.canManage}
          />
        </>
      )}
    </TeamSettingsFrame>
  )
}
