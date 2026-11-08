import { Banner, Checkbox, SectionHeader } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { workspaceSettingsQuery, useSaveWorkspaceSettings } from './api.ts'

import styles from './BuildSettings.module.css'

/** Defaults for the workspace's teams; each team may override them in its settings. */
export function BuildSettings({ workspace }: BuildSettings.Props) {
  const { data } = useQuery(workspaceSettingsQuery(workspace))
  const save = useSaveWorkspaceSettings(workspace)
  if (!data) return null
  return (
    <section className={styles.root}>
      <SectionHeader
        title="Build defaults"
        description="Teams use these unless their own settings say otherwise."
      />
      <Checkbox
        label="Flaky screenshots block merges"
        description="A flaky screenshot keeps changing on the default branch. With this off, a pull request whose only changes are flaky ones passes the gate; the build still lists them as flaky."
        checked={data.settings.flakyBlocksMerge}
        disabled={!data.canManage || save.isPending}
        onCheckedChange={(on) => save.mutate({ flakyBlocksMerge: on })}
      />
      {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
    </section>
  )
}

export namespace BuildSettings {
  export interface Props {
    workspace: string
  }
}
