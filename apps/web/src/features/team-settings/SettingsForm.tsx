import { type Team } from '@circi/api'
import {
  Banner,
  Button,
  ConfirmDialog,
  Select,
  SettingsRow,
  SettingsSection,
  Switch,
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

/** The General page below the appearance: team, repository, comparison, gate, sites. */
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
  const [slug, setSlug] = useState(s.slug)
  const disabled = !props.canManage

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setSaved(false)
    save.mutate(
      buildSettingsPatch(
        {
          name: text(form, 'name'),
          slug: text(form, 'slug'),
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
        onSuccess: (result) => {
          setSaved(true)
          announce('Settings saved')
          // The address in the bar is the old one, which no longer works.
          if (result.settings.slug !== props.team) props.onRenamed(result.settings.slug)
        },
      },
    )
  }

  function discard() {
    setBlockMerge(s.blockMergeOnChanges)
    setFlaky(choiceOf(s.flakyBlocksMerge))
    setAutoApprove(s.autoApproveDefaultBranch)
    setHosting(s.staticHostingEnabled)
    setSlug(s.slug)
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
              name="slug"
              label="Slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              disabled={disabled}
              description={
                <>
                  Used in addresses and in <Text variant="mono">circi admin</Text> commands.
                </>
              }
            />
            <TextField
              name="defaultBranch"
              label="Default branch"
              defaultValue={s.defaultBranch}
              disabled={disabled}
              description="Its approved builds are the baselines."
            />
          </div>
        </SettingsRow>
        {slug.trim() !== s.slug ? (
          <SettingsRow>
            <Banner tone="warning">
              Links with{' '}
              <Text variant="mono">
                /{props.workspace}/{s.slug}
              </Text>{' '}
              in them stop working, including bookmarks and the links in existing pull request
              comments. New builds post the new address. The CI token keeps working.
            </Banner>
          </SettingsRow>
        ) : null}
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
        <SettingsRow
          label="Diff threshold"
          detail="A screenshot counts as changed when more than this share of its pixels differ. A change of size is always a change, whatever the threshold."
        >
          <div className={styles.number} key={version}>
            <TextField
              name="diffThresholdPercent"
              label="Diff threshold"
              hideLabel
              type="number"
              defaultValue={Number((s.diffThreshold * 100).toFixed(4))}
              disabled={disabled}
              min={0}
              max={100}
              step="any"
            />
            <Text tone="secondary">%</Text>
          </div>
        </SettingsRow>
        <SettingsRow
          label="Keep builds for"
          detail="Older builds and their hosted sites expire. The newest approved baseline on the default branch never does."
        >
          <div className={styles.number} key={version}>
            <TextField
              name="retentionDays"
              label="Keep builds for (days)"
              hideLabel
              type="number"
              defaultValue={s.retentionDays}
              disabled={disabled}
              min={1}
              step={1}
            />
            <Text tone="secondary">days</Text>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Merge gate"
        description="What the check on a pull request says while changes wait for review. It only blocks merging if the repository marks it as required."
      >
        <SettingsRow>
          <Switch
            label="Unreviewed changes block merging"
            description="The check stays pending until someone approves. Off: it passes with a “changes to review” summary."
            checked={blockMerge}
            onCheckedChange={setBlockMerge}
            disabled={disabled}
          />
        </SettingsRow>
        <SettingsRow>
          <Select
            label="Flaky-only changes block merging"
            description="When the only changes are to flaky screenshots (ones that keep changing on the default branch). Off: the pull request passes; the build still lists them as flaky."
            items={flakyChoices(props.workspaceFlakyBlocksMerge)}
            value={flaky}
            onValueChange={(next) => {
              if (isFlakyChoice(next)) setFlaky(next)
            }}
            disabled={disabled}
          />
        </SettingsRow>
        <SettingsRow>
          <Switch
            label="Approve default-branch builds automatically"
            description="Builds on the default branch become the new baseline without a review. Needs an approved baseline to compare with, so a team’s first build is always reviewed."
            checked={autoApprove}
            onCheckedChange={setAutoApprove}
            disabled={disabled}
          />
        </SettingsRow>
      </SettingsSection>

      {props.sitesConfigured ? (
        <SettingsSection
          title="Hosted sites"
          description="Storybook, test reports and docs for each commit, behind sign-in. Needs the sites domain set on the server."
        >
          <SettingsRow>
            <Switch
              label="Host static sites"
              description={
                <>
                  Upload with <Text variant="mono">circi site upload</Text>. Sites are served from
                  the sites domain and need sign-in; only members of this workspace can open them.
                </>
              }
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
            {save.isPending ? 'Saving…' : 'Save changes'}
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
    /** The team's slug changed: the page moves to the new address. */
    onRenamed: (slug: string) => void
  }
}
