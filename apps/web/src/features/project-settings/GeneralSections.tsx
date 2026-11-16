import { type Project } from '@circi/api'
import {
  Banner,
  Button,
  Checkbox,
  ConfirmDialog,
  NumberField,
  Select,
  SettingsRow,
  SettingsSection,
  Text,
} from '@circi/ui'
import { type FormEvent, useState } from 'react'

import { type useSaveSettings, useUnlinkRepository } from '#features/projects/api/index.ts'
import { HttpError } from '#lib/http.ts'
import { numberOf, textOf } from '#lib/number-field.ts'
import { toast } from '#lib/toast.ts'
import { useClientLink } from '#lib/use-client-link.ts'

import { choiceOf, flakyChoices, type FlakyChoice, isFlakyChoice } from './flaky-setting.ts'
import {
  buildSettingsPatch,
  SETTINGS_FIELDS,
  settingsProblems,
  type SettingsField,
} from './settings-patch.ts'

import styles from './ProjectSettings.module.css'

/**
 * The General page below the display settings (name, address, default branch, icon and colour, which save on their own): the settings that change
 * how builds are judged, saved together with one Save (and Discard): repository, comparison,
 * merge gate, sites.
 */
export function SettingsForm(props: SettingsForm.Props) {
  // The page owns the save and its confirmation: saving refetches the settings, which remounts
  // this form (it is keyed by them), and a remounted form would lose both.
  const { save, saved, onSavedChange: setSaved } = props
  const unlink = useUnlinkRepository(props.workspace, props.project)
  const clientLink = useClientLink()
  const [unlinking, setUnlinking] = useState(false)
  const s = props.settings
  const percent = () => String(Number((s.diffThreshold * 100).toFixed(4)))
  const [threshold, setThreshold] = useState(percent)
  const [retention, setRetention] = useState(String(s.retentionDays))
  // Fields the person has left, or all of them after a try to save: only then are problems shown.
  const [touched, setTouched] = useState<ReadonlySet<SettingsField>>(new Set())
  const [blockMerge, setBlockMerge] = useState(s.blockMergeOnChanges)
  const [flaky, setFlaky] = useState<FlakyChoice>(choiceOf(s.flakyBlocksMerge))
  const [autoApprove, setAutoApprove] = useState(s.autoApproveDefaultBranch)
  const [hosting, setHosting] = useState(s.staticHostingEnabled)
  const disabled = !props.canManage
  // Save and Discard wait for a change, like the other settings pages. The form remounts on the
  // saved settings, so "changed" is always against what is stored.
  const dirty =
    threshold !== percent() ||
    retention !== String(s.retentionDays) ||
    blockMerge !== s.blockMergeOnChanges ||
    flaky !== choiceOf(s.flakyBlocksMerge) ||
    autoApprove !== s.autoApproveDefaultBranch ||
    hosting !== s.staticHostingEnabled

  const found = settingsProblems({ diffThresholdPercent: threshold, retentionDays: retention })
  // What the server refused, by field, when it says which (otherwise the banner below says it).
  const served = save.error instanceof HttpError ? save.error.fields : {}
  const shown = (field: SettingsField) =>
    (touched.has(field) ? found[field] : undefined) ?? served[field]
  const fieldErrors = Object.keys(served).some((field) =>
    SETTINGS_FIELDS.some((known) => known === field),
  )
  const touch = (field: SettingsField) => () => setTouched((t) => new Set(t).add(field))
  // Typing clears what the server said about that field.
  const edited = () => {
    if (save.isError) save.reset()
    setSaved(false)
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setTouched(new Set(SETTINGS_FIELDS))
    if (Object.keys(found).length > 0) return
    setSaved(false)
    save.mutate(
      buildSettingsPatch(
        {
          diffThresholdPercent: threshold,
          retentionDays: retention,
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
          toast('Settings saved')
        },
      },
    )
  }

  function discard() {
    setBlockMerge(s.blockMergeOnChanges)
    setFlaky(choiceOf(s.flakyBlocksMerge))
    setAutoApprove(s.autoApproveDefaultBranch)
    setHosting(s.staticHostingEnabled)
    setThreshold(percent())
    setRetention(String(s.retentionDays))
    setTouched(new Set())
    setSaved(false)
    save.reset()
  }

  const link = props.link
  const integrations = clientLink({
    to: '/workspaces/$workspace/settings/integrations',
    params: { workspace: props.workspace },
  })

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <div className={styles.group}>
        <SettingsSection
          title="Repository"
          description="With a linked repository, CirCI posts a check and one summary comment on each pull request. Git hosts are connected in the workspace's integrations."
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
                aria-label="Remove repository link"
                onClick={() => {
                  unlink.reset()
                  setUnlinking(true)
                }}
              >
                Remove
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
          <NumberField
            className={styles.number}
            name="diffThresholdPercent"
            label="Diff threshold"
            hideLabel
            unit="%"
            value={numberOf(threshold)}
            onValueChange={(next) => {
              setThreshold(textOf(next))
              edited()
            }}
            inputProps={{ onBlur: touch('diffThreshold') }}
            error={shown('diffThreshold')}
            disabled={disabled}
            step="any"
          />
        </SettingsRow>
        <SettingsRow
          id="retention"
          label="Keep builds for"
          detail="Older builds and their hosted sites expire. The newest approved baseline on the default branch never does."
        >
          <NumberField
            className={styles.number}
            name="retentionDays"
            label="Keep builds for (days)"
            hideLabel
            unit="days"
            value={numberOf(retention)}
            onValueChange={(next) => {
              setRetention(textOf(next))
              edited()
            }}
            inputProps={{ onBlur: touch('retentionDays') }}
            error={shown('retentionDays')}
            disabled={disabled}
            step={1}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Merge gate"
        description="What the check on a pull request says while changes wait for review. It only blocks merging if the repository marks it as required."
      >
        <SettingsRow>
          <Checkbox
            label="Unreviewed changes block merging"
            description="The check stays pending until someone approves. Off: it passes with a “changes to review” summary."
            checked={blockMerge}
            onCheckedChange={setBlockMerge}
            disabled={disabled}
          />
        </SettingsRow>
        <SettingsRow id="merge-gate">
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
          <Checkbox
            label="Approve default-branch builds automatically"
            description="Builds on the default branch become the new baseline without a review. Needs an approved baseline to compare with, so a project's first build is always reviewed."
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
            <Checkbox
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

      {save.error && !fieldErrors ? <Banner tone="danger">{save.error.message}</Banner> : null}
      {saved ? <Banner tone="success">Settings saved.</Banner> : null}
      {props.canManage ? (
        <div className={styles.footer} data-save-bar="" data-clean={dirty ? undefined : ''}>
          <Button
            type="button"
            variant="ghost"
            onClick={discard}
            disabled={!dirty || save.isPending}
          >
            Discard
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={unlinking}
        onOpenChange={setUnlinking}
        title="Remove the repository link?"
        description={`CirCI stops posting checks and comments on ${link?.repoRef ?? 'its'} pull requests. Builds already uploaded stay.`}
        confirmLabel="Remove"
        loading={unlink.isPending}
        onConfirm={() =>
          unlink.mutate(undefined, {
            onSuccess: () => toast('Repository link removed'),
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
    project: string
    settings: Project.Settings
    canManage: boolean
    link: Project.GithubLink | null
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
