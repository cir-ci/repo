import { Banner, SectionHeader, Switch } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { workspaceSettingsQuery, useSaveWorkspaceSettings } from '#features/members/api.ts'

import { Box, BoxRow } from './Box.tsx'

import styles from './Settings.module.css'

/** Defaults for the workspace's teams; each team may override them in its settings. */
export function BuildSettings({ workspace }: BuildSettings.Props) {
  const { data } = useQuery(workspaceSettingsQuery(workspace))
  const save = useSaveWorkspaceSettings(workspace)
  if (!data) return null
  return (
    <section className={styles.section}>
      <SectionHeader
        title="Merge gate defaults"
        description="Every team follows these unless its own settings override them."
      />
      <Box>
        <BoxRow top>
          <Switch
            label="Flaky screenshots block merges"
            description="A flaky screenshot changed in 3 or more of the last 10 builds on the default branch. With this off, a pull request whose only changes are flaky screenshots passes the check; the build still lists them as flaky."
            checked={data.settings.flakyBlocksMerge}
            disabled={!data.canManage || save.isPending}
            onCheckedChange={(on) => save.mutate({ flakyBlocksMerge: on })}
          />
        </BoxRow>
      </Box>
      {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
    </section>
  )
}

export namespace BuildSettings {
  export interface Props {
    workspace: string
  }
}
