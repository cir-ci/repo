import { type Project } from '@circi/api'
import { Banner, Button, Checkbox, SectionHeader, Select, TextField, useAnnounce } from '@circi/ui'
import { type FormEvent, useState } from 'react'

import { useSaveSettings } from './api.ts'
import {
  choiceOf,
  flakyChoices,
  type FlakyChoice,
  isFlakyChoice,
  valueOf,
} from './flaky-setting.ts'

import styles from './SettingsSection.module.css'

export function SettingsForm(props: SettingsForm.Props) {
  const save = useSaveSettings(props.org, props.project)
  const announce = useAnnounce()
  const [saved, setSaved] = useState(false)
  const s = props.settings
  const [blockMerge, setBlockMerge] = useState(s.blockMergeOnChanges)
  const [flaky, setFlaky] = useState<FlakyChoice>(choiceOf(s.flakyBlocksMerge))
  const [autoApprove, setAutoApprove] = useState(s.autoApproveDefaultBranch)
  const [hosting, setHosting] = useState(s.staticHostingEnabled)
  const disabled = !props.canManage

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const text = (key: string) => {
      const v = form.get(key)
      return typeof v === 'string' ? v : ''
    }
    setSaved(false)
    save.mutate(
      {
        name: text('name'),
        defaultBranch: text('defaultBranch'),
        diffThreshold: Number(text('diffThresholdPercent')) / 100,
        retentionDays: Number(text('retentionDays')),
        autoApproveDefaultBranch: autoApprove,
        blockMergeOnChanges: blockMerge,
        flakyBlocksMerge: valueOf(flaky),
        // The box only exists when the instance can host sites; otherwise leave the setting be.
        ...(props.sitesConfigured ? { staticHostingEnabled: hosting } : {}),
      },
      {
        onSuccess: () => {
          setSaved(true)
          announce('Settings saved')
        },
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate className={styles['section']}>
      <SectionHeader title="Builds" />
      <div className={styles['fields']}>
        <TextField name="name" label="Name" defaultValue={s.name} disabled={disabled} />
        <TextField
          name="defaultBranch"
          label="Default branch"
          defaultValue={s.defaultBranch}
          disabled={disabled}
          description="Builds on this branch become the baselines that pull requests are compared with."
        />
        <TextField
          name="diffThresholdPercent"
          label="Ignore differences below (% of pixels)"
          type="number"
          defaultValue={Number((s.diffThreshold * 100).toFixed(4))}
          disabled={disabled}
          min={0}
          max={100}
          step="any"
          description="0 reports every changed pixel."
        />
        <TextField
          name="retentionDays"
          label="Keep builds for (days)"
          type="number"
          defaultValue={s.retentionDays}
          disabled={disabled}
          min={1}
          step={1}
        />
        <div className={styles['checks']}>
          <Checkbox
            label="Block merging until changes are approved"
            description="With this off, `circi upload --wait` passes even when visual changes need review."
            checked={blockMerge}
            onCheckedChange={setBlockMerge}
            disabled={disabled}
          />
          <Select
            label="Flaky screenshots block merges"
            description="A flaky screenshot keeps changing on the default branch. With this off, a pull request whose only changes are flaky ones passes the gate; the build still lists them as flaky."
            items={flakyChoices(props.orgFlakyBlocksMerge)}
            value={flaky}
            onValueChange={(next) => {
              if (isFlakyChoice(next)) setFlaky(next)
            }}
            disabled={disabled}
          />
          <Checkbox
            label="Approve builds on the default branch automatically"
            description="Applies once there is an approved baseline: a project's first build always waits for someone to review it."
            checked={autoApprove}
            onCheckedChange={setAutoApprove}
            disabled={disabled}
          />
          {props.sitesConfigured ? (
            <Checkbox
              label="Host static sites (Storybook, reports) for this project"
              description="Upload with `circi site upload`. Sites are served from the sites domain and need sign-in; only members of this organization can open them."
              checked={hosting}
              onCheckedChange={setHosting}
              disabled={disabled}
            />
          ) : null}
        </div>
        {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
        {saved ? <Banner tone="success">Settings saved.</Banner> : null}
        {props.canManage ? (
          <div className={styles['actions']}>
            <Button type="submit" variant="primary" loading={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        ) : null}
      </div>
    </form>
  )
}

export namespace SettingsForm {
  export interface Props {
    org: string
    project: string
    settings: Project.Settings
    canManage: boolean
    /** The organization's setting, which "inherit" follows. */
    orgFlakyBlocksMerge: boolean
    /** The instance can host sites (so the switch is shown). */
    sitesConfigured?: boolean
  }
}
