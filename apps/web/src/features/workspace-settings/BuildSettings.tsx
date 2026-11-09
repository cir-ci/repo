import type { Workspace } from '@circi/api'
import { Banner, Button, Checkbox, SettingsRow, SettingsSection, useAnnounce } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { workspaceSettingsQuery, useSaveWorkspaceSettings } from '#features/members/api.ts'

import { inheritance } from './model.ts'

import styles from './Settings.module.css'

/**
 * Defaults for the workspace's teams; each team may override them in its settings. The merge gate
 * decides what a pull request's check says, so a change waits for Save (with Discard).
 */
export function BuildSettings({ workspace }: BuildSettings.Props) {
  const { data } = useQuery(workspaceSettingsQuery(workspace))
  if (!data) return null
  return <Defaults key={String(data.settings.flakyBlocksMerge)} workspace={workspace} data={data} />
}

function Defaults({ workspace, data }: Defaults.Props) {
  const save = useSaveWorkspaceSettings(workspace)
  const announce = useAnnounce()
  const saved = data.settings.flakyBlocksMerge
  const [flaky, setFlaky] = useState(saved)
  const dirty = flaky !== saved
  const { summary, overrides } = inheritance(data.teams)
  return (
    <>
      <SettingsSection
        title="Merge gate defaults"
        description="Every team follows these unless its own settings override them. Changes apply when you press Save changes."
      >
        <SettingsRow>
          <Checkbox
            label="Flaky screenshots block merges"
            description="A flaky screenshot changed in 3 or more of the last 10 builds on the default branch. With this off, a pull request whose only changes are flaky screenshots passes the check; the build still lists them as flaky."
            checked={flaky}
            disabled={!data.canManage || save.isPending}
            onCheckedChange={(on) => {
              setFlaky(on)
              if (save.isError) save.reset()
            }}
          />
        </SettingsRow>
        {data.teams.length > 0 ? (
          <SettingsRow detail={summary} value={overrides.join(', ') || undefined} />
        ) : null}
      </SettingsSection>
      {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
      {data.canManage ? (
        <div className={styles.footer}>
          <Button
            variant="ghost"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setFlaky(saved)
              save.reset()
            }}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!dirty}
            onClick={() =>
              save.mutate(
                { flakyBlocksMerge: flaky },
                { onSuccess: () => announce('Merge gate defaults saved') },
              )
            }
          >
            Save changes
          </Button>
        </div>
      ) : null}
    </>
  )
}

export namespace BuildSettings {
  export interface Props {
    workspace: string
  }
}

namespace Defaults {
  export interface Props {
    workspace: string
    data: Workspace.SettingsResponse
  }
}
