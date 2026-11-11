import type { Workspace } from '@circi/api'
import { Banner, Button, Checkbox, SettingsRow, SettingsSection } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import type { NavigateOptions } from '@tanstack/react-router'
import { useState } from 'react'

import { workspaceSettingsQuery, useSaveWorkspaceSettings } from '#features/members/api.ts'
import { ProjectAvatars } from '#lib/ProjectAvatars.tsx'
import { toast } from '#lib/toast.ts'

import { inheritance } from './model.ts'

import styles from './Settings.module.css'

/**
 * Defaults for the workspace's projects; each project may override them in its settings. The merge gate
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
  const saved = data.settings.flakyBlocksMerge
  const savedAssign = data.settings.assignTriageToOnCall
  const [flaky, setFlaky] = useState(saved)
  const [assign, setAssign] = useState(savedAssign)
  const dirty = flaky !== saved || assign !== savedAssign
  return (
    <>
      <SettingsSection
        title="Merge gate defaults"
        description="Every project follows these unless its own settings override them."
      >
        <SettingsRow>
          <Checkbox
            label="Flaky-only changes block merging"
            description="A flaky screenshot changed in 3 or more of the last 10 commits on the default branch. With this off, a pull request whose only changes are flaky screenshots passes the check; the build still lists them as flaky."
            checked={flaky}
            disabled={!data.canManage || save.isPending}
            onCheckedChange={(on) => {
              setFlaky(on)
              if (save.isError) save.reset()
            }}
          />
        </SettingsRow>
        {data.projects.length > 0 ? (
          <SettingsRow>
            <Followers
              split={inheritance(data.projects)}
              link={(project) => ({
                to: '/$workspace/$project/settings/general',
                params: { workspace, project: project.slug },
                hash: 'merge-gate',
              })}
            />
          </SettingsRow>
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
        {data.projects.length > 0 ? (
          <SettingsRow>
            <Followers
              split={inheritance(data.projects, 'assignTriageToOnCall')}
              link={(project) => ({
                to: '/$workspace/$project/settings/reviews',
                params: { workspace, project: project.slug },
                hash: 'assign-on-call',
              })}
            />
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
      {data.canManage ? (
        <div className={styles.footer} data-save-bar="" data-clean={dirty ? undefined : ''}>
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
                { onSuccess: () => toast('Defaults saved') },
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

/**
 * "<projects> inherit this" and, when some projects have their own value, "<projects> set their own": each
 * project an avatar that links to the project's setting.
 */
function Followers({ split, link }: Followers.Props) {
  const { inheriting, overriding } = split
  return (
    <div className={styles.followers}>
      <span className={styles.followGroup}>
        {inheriting.length === 0 ? (
          'No project inherits this'
        ) : (
          <>
            <ProjectAvatars projects={inheriting} link={link} />
            {inheriting.length === 1 ? 'inherits this' : 'inherit this'}
          </>
        )}
      </span>
      {overriding.length > 0 ? (
        <span className={styles.followGroup}>
          <ProjectAvatars projects={overriding} link={link} note={(project) => project.value} />
          {overriding.length === 1 ? 'sets its own' : 'set their own'}
        </span>
      ) : null}
    </div>
  )
}

export namespace BuildSettings {
  export interface Props {
    workspace: string
  }
}

namespace Followers {
  export interface Props {
    split: ReturnType<typeof inheritance<Workspace.ProjectOverride>>
    link: (project: Workspace.ProjectOverride) => NavigateOptions
  }
}

namespace Defaults {
  export interface Props {
    workspace: string
    data: Workspace.SettingsResponse
  }
}
