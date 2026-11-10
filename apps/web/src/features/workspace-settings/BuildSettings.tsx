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
  const key = `${data.settings.flakyBlocksMerge}-${data.settings.assignTriageToOnCall}`
  return <Defaults key={key} workspace={workspace} data={data} />
}

function Defaults({ workspace, data }: Defaults.Props) {
  const save = useSaveWorkspaceSettings(workspace)
  const announce = useAnnounce()
  const saved = data.settings.flakyBlocksMerge
  const savedAssign = data.settings.assignTriageToOnCall
  const [flaky, setFlaky] = useState(saved)
  const [assign, setAssign] = useState(savedAssign)
  const dirty = flaky !== saved || assign !== savedAssign
  const { summary, overrides } = inheritance(data.teams)
  const triage = inheritance(data.teams, 'assignTriageToOnCall')
  return (
    <>
      <SettingsSection
        title="Merge gate defaults"
        description="Every team follows these unless its own settings override them."
      >
        <SettingsRow>
          <Checkbox
            label="Flaky-only changes block merging"
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
      <SettingsSection title="Triage defaults">
        <SettingsRow>
          <Checkbox
            label="Assign new triage items to whoever is on triage"
            description="Items nobody has go to the person on triage, and move to the next person at the handover. Items someone assigns or unassigns stay as they left them."
            checked={assign}
            disabled={!data.canManage || save.isPending}
            onCheckedChange={(on) => {
              setAssign(on)
              if (save.isError) save.reset()
            }}
          />
        </SettingsRow>
        {data.teams.length > 0 ? (
          <SettingsRow detail={triage.summary} value={triage.overrides.join(', ') || undefined} />
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
              setAssign(savedAssign)
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
                {
                  ...(flaky === saved ? {} : { flakyBlocksMerge: flaky }),
                  ...(assign === savedAssign ? {} : { assignTriageToOnCall: assign }),
                },
                { onSuccess: () => announce('Defaults saved') },
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
