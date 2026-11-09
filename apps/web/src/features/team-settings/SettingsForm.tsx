import { type Team } from '@circi/api'
import {
  Banner,
  Button,
  Checkbox,
  ConfirmDialog,
  Select,
  SettingsRow,
  SettingsSection,
  Text,
  TextField,
  useAnnounce,
} from '@circi/ui'
import { type FormEvent, useState } from 'react'

import { type useSaveSettings, useUnlinkRepository } from '#features/teams/api/index.ts'
import { useClientLink } from '#lib/use-client-link.ts'

import { choiceOf, flakyChoices, type FlakyChoice, isFlakyChoice } from './flaky-setting.ts'
import { buildSettingsPatch } from './settings-patch.ts'

import styles from './TeamSettings.module.css'

const text = (form: FormData, key: string) => {
  const v = form.get(key)
  return typeof v === 'string' ? v : ''
}

/** The board's General page below the appearance: team, repository, comparison, gate, sites. */
export function SettingsForm(props: SettingsForm.Props) {
  // The page owns the save and its confirmation: saving refetches the settings, which remounts
  // this form (it is keyed by them), and a remounted form would lose both.
  const { save, saved, onSavedChange: setSaved } = props
  const unlink = useUnlinkRepository(props.workspace, props.team)
  const announce = useAnnounce()
  const clientLink = useClientLink()
  const [unlinking, setUnlinking] = useState(false)
  // Discard remounts the fields from the saved values.
  const [version, setVersion] = useState(0)
  const s = props.settings
  const [blockMerge, setBlockMerge] = useState(s.blockMergeOnChanges)
  const [flaky, setFlaky] = useState<FlakyChoice>(choiceOf(s.flakyBlocksMerge))
  const [autoApprove, setAutoApprove] = useState(s.autoApproveDefaultBranch)
  const [hosting, setHosting] = useState(s.staticHostingEnabled)
  const disabled = !props.canManage

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setSaved(false)
    save.mutate(
      buildSettingsPatch(
        {
          name: text(form, 'name'),
          defaultBranch: text(form, 'defaultBranch'),
          diffThresholdPercent: text(form, 'diffThresholdPercent'),
          retentionDays: text(form, 'retentionDays'),
          autoApprove,
          blockMerge,
          flaky,
          hosting,
        },
        props.sitesConfigured === true,
      ),
      {
        onSuccess: () => {
          setSaved(true)
          announce('Settings saved')
        },
      },
    )
  }

  function discard() {
    setBlockMerge(s.blockMergeOnChanges)
    setFlaky(choiceOf(s.flakyBlocksMerge))
    setAutoApprove(s.autoApproveDefaultBranch)
    setHosting(s.staticHostingEnabled)
    setSaved(false)
    save.reset()
    setVersion((v) => v + 1)
  }

  const link = props.link
  const integrations = clientLink({
    to: '/workspaces/$workspace/settings/integrations',
    params: { workspace: props.workspace },
  })

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <SettingsSection title="Team">
        <SettingsRow>
          <div className={styles.fields} key={version}>
            <TextField name="name" label="Name" defaultValue={s.name} disabled={disabled} />
            <TextField
              name="defaultBranch"
              label="Default branch"
              defaultValue={s.defaultBranch}
              disabled={disabled}
              description="Its approved builds are the baselines."
            />
          </div>
        </SettingsRow>
      </SettingsSection>

      <div className={styles.group}>
        <SettingsSection
          title="Repository"
          description="With a linked repository, CirCI posts a check and one summary comment on each pull request. Git hosts are connected in the workspace’s integrations."
        >
          <SettingsRow
            label={link ? <Text variant="mono">{link.repoRef}</Text> : 'No repository linked'}
            detail={link ? 'GitHub · checks named CirCI / <build name>' : undefined}
          >
            <Button size="sm" {...integrations}>
              {link ? 'Change' : 'Link a repository'}
            </Button>
            {link && props.canManage ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  unlink.reset()
                  setUnlinking(true)
                }}
              >
                Unlink
              </Button>
            ) : null}
          </SettingsRow>
        </SettingsSection>
        {unlink.error && !unlinking ? <Banner tone="danger">{unlink.error.message}</Banner> : null}
      </div>

      <SettingsSection title="Comparison">
        <SettingsRow>
          <div className={styles.fields} key={version}>
            <TextField
              name="diffThresholdPercent"
              label="Ignore differences below (% of pixels)"
              type="number"
              defaultValue={Number((s.diffThreshold * 100).toFixed(4))}
              disabled={disabled}
              min={0}
              max={100}
              step="any"
              description="0 reports every changed pixel. A change of size is always a change."
            />
            <TextField
              name="retentionDays"
              label="Keep builds for (days)"
              type="number"
              defaultValue={s.retentionDays}
              disabled={disabled}
              min={1}
              step={1}
              description="Older builds and their hosted sites expire. The newest approved baseline on the default branch never does."
            />
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Merge gate"
        description="What the check on a pull request says while changes wait for review. It only blocks merging if the repository marks it as required."
      >
        <SettingsRow>
          <Checkbox
            label="Block merging until changes are approved"
            description="With this off, `circi upload --wait` passes even when visual changes need review."
            checked={blockMerge}
            onCheckedChange={setBlockMerge}
            disabled={disabled}
          />
        </SettingsRow>
        <SettingsRow>
          <Select
            label="Flaky screenshots block merges"
            description="A flaky screenshot keeps changing on the default branch. With this off, a pull request whose only changes are flaky ones passes the gate; the build still lists them as flaky."
            items={flakyChoices(props.workspaceFlakyBlocksMerge)}
            value={flaky}
            onValueChange={(next) => {
              if (isFlakyChoice(next)) setFlaky(next)
            }}
            disabled={disabled}
          />
        </SettingsRow>
        <SettingsRow>
          <Checkbox
            label="Approve builds on the default branch automatically"
            description="Applies once there is an approved baseline: a team's first build always waits for someone to review it."
            checked={autoApprove}
            onCheckedChange={setAutoApprove}
            disabled={disabled}
          />
        </SettingsRow>
      </SettingsSection>

      {props.sitesConfigured ? (
        <SettingsSection
          title="Hosted sites"
          description="Storybook, test reports and docs for each commit, behind sign-in."
        >
          <SettingsRow>
            <Checkbox
              label="Host static sites (Storybook, reports) for this team"
              description="Upload with `circi site upload`. Sites are served from the sites domain and need sign-in; only members of this workspace can open them."
              checked={hosting}
              onCheckedChange={setHosting}
              disabled={disabled}
            />
          </SettingsRow>
        </SettingsSection>
      ) : null}

      {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
      {saved ? <Banner tone="success">Settings saved.</Banner> : null}
      {props.canManage ? (
        <div className={styles.footer}>
          <Button type="button" variant="ghost" onClick={discard}>
            Discard
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={unlinking}
        onOpenChange={setUnlinking}
        title="Unlink the repository?"
        description={`CirCI stops posting checks and comments on ${link?.repoRef ?? 'its'} pull requests. Builds already uploaded stay.`}
        confirmLabel="Unlink"
        loading={unlink.isPending}
        onConfirm={() =>
          unlink.mutate(undefined, {
            onSuccess: () => announce('Repository unlinked'),
            onSettled: () => setUnlinking(false),
          })
        }
      />
    </form>
  )
}

export namespace SettingsForm {
  export interface Props {
    workspace: string
    team: string
    settings: Team.Settings
    canManage: boolean
    link: Team.GithubLink | null
    /** The workspace's setting, which "inherit" follows. */
    workspaceFlakyBlocksMerge: boolean
    /** The instance can host sites (so the switch is shown). */
    sitesConfigured?: boolean
    /** The save mutation, held by the page so it outlives a remount of this form. */
    save: ReturnType<typeof useSaveSettings>
    /** Whether to show "Settings saved." (also held by the page). */
    saved: boolean
    onSavedChange: (saved: boolean) => void
  }
}
