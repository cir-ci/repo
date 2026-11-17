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
  TextField,
} from '@circi/ui'
import { useState } from 'react'

import { type useSaveSettings, useUnlinkRepository } from '#features/projects/api/index.ts'
import { HttpError } from '#lib/http.ts'
import { numberOf, textOf } from '#lib/number-field.ts'
import { toast } from '#lib/toast.ts'
import { useClientLink } from '#lib/use-client-link.ts'

import { choiceOf, flakyChoices, type FlakyChoice, isFlakyChoice } from './flaky-setting.ts'
import { SectionForm } from './SectionForm.tsx'
import {
  comparisonPatch,
  mergeGatePatch,
  SETTINGS_FIELDS,
  settingsProblems,
  type SettingsField,
} from './settings-patch.ts'

import styles from './ProjectSettings.module.css'

/** What every section takes: the settings, who may edit, and its own save mutation. */
interface SectionProps {
  settings: Project.Settings
  canManage: boolean
  save: ReturnType<typeof useSaveSettings>
}

/** The repository's link: a row of actions that apply at once (the unlink asks first), so no Save. */
export function RepositorySection(props: {
  workspace: string
  project: string
  canManage: boolean
  link: Project.GithubLink | null
}) {
  const unlink = useUnlinkRepository(props.workspace, props.project)
  const clientLink = useClientLink()
  const [unlinking, setUnlinking] = useState(false)
  const link = props.link
  const integrations = clientLink({
    to: '/workspaces/$workspace/settings/integrations',
    params: { workspace: props.workspace },
  })
  return (
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
    </div>
  )
}

const percentOf = (threshold: number) => String(Number((threshold * 100).toFixed(4)))

/** Diff threshold and retention, saved together. */
export function ComparisonSection({ settings: s, canManage, save }: SectionProps) {
  const [threshold, setThreshold] = useState(percentOf(s.diffThreshold))
  const [retention, setRetention] = useState(String(s.retentionDays))
  // Fields the person has left, or all of them after a try to save: only then are problems shown.
  const [touched, setTouched] = useState<ReadonlySet<SettingsField>>(new Set())
  const dirty = threshold !== percentOf(s.diffThreshold) || retention !== String(s.retentionDays)
  const found = settingsProblems({ diffThresholdPercent: threshold, retentionDays: retention })
  // What the server refused, by field, when it says which (otherwise the banner says it).
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
  }

  return (
    <SectionForm
      id="comparison"
      title="Comparison"
      dirty={dirty}
      pending={save.isPending}
      canManage={canManage}
      error={save.error && !fieldErrors ? save.error.message : null}
      onDiscard={() => {
        setThreshold(percentOf(s.diffThreshold))
        setRetention(String(s.retentionDays))
        setTouched(new Set())
        save.reset()
      }}
      onSave={() => {
        setTouched(new Set(SETTINGS_FIELDS))
        if (Object.keys(found).length > 0) return
        save.mutate(
          comparisonPatch({ diffThresholdPercent: threshold, retentionDays: retention }),
          { onSuccess: () => toast('Comparison settings saved') },
        )
      }}
    >
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
          disabled={!canManage}
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
          disabled={!canManage}
          step={1}
        />
      </SettingsRow>
    </SectionForm>
  )
}

/** What the pull request's check says while changes wait: blocking, flaky-only changes, auto-approval. */
export function MergeGateSection({
  settings: s,
  canManage,
  save,
  workspaceFlakyBlocksMerge,
}: SectionProps & { workspaceFlakyBlocksMerge: boolean }) {
  const [blockMerge, setBlockMerge] = useState(s.blockMergeOnChanges)
  const [flaky, setFlaky] = useState<FlakyChoice>(choiceOf(s.flakyBlocksMerge))
  const [autoApprove, setAutoApprove] = useState(s.autoApproveDefaultBranch)
  const dirty =
    blockMerge !== s.blockMergeOnChanges ||
    flaky !== choiceOf(s.flakyBlocksMerge) ||
    autoApprove !== s.autoApproveDefaultBranch
  return (
    <SectionForm
      id="merge-gate"
      title="Merge gate"
      description="What the check on a pull request says while changes wait for review. It only blocks merging if the repository marks it as required."
      dirty={dirty}
      pending={save.isPending}
      canManage={canManage}
      error={save.error?.message}
      onDiscard={() => {
        setBlockMerge(s.blockMergeOnChanges)
        setFlaky(choiceOf(s.flakyBlocksMerge))
        setAutoApprove(s.autoApproveDefaultBranch)
        save.reset()
      }}
      onSave={() =>
        save.mutate(mergeGatePatch({ autoApprove, blockMerge, flaky }), {
          onSuccess: () => toast('Merge gate saved'),
        })
      }
    >
      <SettingsRow>
        <Checkbox
          label="Unreviewed changes block merging"
          description="The check stays pending until someone approves. Off: it passes with a “changes to review” summary."
          checked={blockMerge}
          onCheckedChange={setBlockMerge}
          disabled={!canManage}
        />
      </SettingsRow>
      <SettingsRow id="merge-gate">
        <Select
          label="Flaky-only changes block merging"
          description="When the only changes are to flaky screenshots (ones that keep changing on the default branch). Off: the pull request passes; the build still lists them as flaky."
          items={flakyChoices(workspaceFlakyBlocksMerge)}
          value={flaky}
          onValueChange={(next) => {
            if (isFlakyChoice(next)) setFlaky(next)
          }}
          disabled={!canManage}
        />
      </SettingsRow>
      <SettingsRow>
        <Checkbox
          label="Approve default-branch builds automatically"
          description="Builds on the default branch become the new baseline without a review. Needs an approved baseline to compare with, so a project's first build is always reviewed."
          checked={autoApprove}
          onCheckedChange={setAutoApprove}
          disabled={!canManage}
        />
      </SettingsRow>
    </SectionForm>
  )
}

/**
 * Hosting static sites, and where they come from. Uploading from GitHub Actions is a workflow
 * setting (it changes what gets published), so it waits for Save with the rest of the section.
 */
export function HostedSitesSection({
  settings: s,
  canManage,
  save,
  githubLinked,
  lastResult,
}: SectionProps & {
  /** The project is linked to a GitHub repository (the artifacts come from its runs). */
  githubLinked: boolean
  lastResult: Project.SitesFromActionsResult | null
}) {
  const [hosting, setHosting] = useState(s.staticHostingEnabled)
  const [fromActions, setFromActions] = useState(s.sitesFromActions)
  const [artifact, setArtifact] = useState(s.sitesArtifactName)
  const [siteName, setSiteName] = useState(s.sitesArtifactSiteName ?? '')
  const patch: Partial<Project.Settings> = {
    ...(hosting !== s.staticHostingEnabled ? { staticHostingEnabled: hosting } : {}),
    ...(fromActions !== s.sitesFromActions ? { sitesFromActions: fromActions } : {}),
    ...(artifact.trim() !== s.sitesArtifactName ? { sitesArtifactName: artifact.trim() } : {}),
    ...(siteName.trim() !== (s.sitesArtifactSiteName ?? '')
      ? { sitesArtifactSiteName: siteName.trim() || null }
      : {}),
  }
  const artifactProblem = artifact.trim() ? null : 'Enter the artifact name'
  return (
    <SectionForm
      id="hosted-sites"
      title="Hosted sites"
      description="Storybook, test reports and docs for each commit, behind sign-in. Needs the sites domain set on the server."
      dirty={Object.keys(patch).length > 0}
      pending={save.isPending}
      canManage={canManage}
      error={save.error?.message}
      onDiscard={() => {
        setHosting(s.staticHostingEnabled)
        setFromActions(s.sitesFromActions)
        setArtifact(s.sitesArtifactName)
        setSiteName(s.sitesArtifactSiteName ?? '')
        save.reset()
      }}
      onSave={() => {
        if (artifactProblem) return
        save.mutate(patch, { onSuccess: () => toast('Hosted sites saved') })
      }}
    >
      <SettingsRow>
        <Checkbox
          label="Host static sites"
          description={
            <>
              Upload with <Text variant="mono">circi site upload</Text>. Sites are served from the
              sites domain and need sign-in; only members of this workspace can open them.
            </>
          }
          checked={hosting}
          onCheckedChange={setHosting}
          disabled={!canManage}
        />
      </SettingsRow>
      {hosting ? (
        <SettingsRow>
          <div className={styles.fields}>
            <Checkbox
              label="Upload sites from GitHub Actions"
              description={
                githubLinked ? (
                  <>
                    Publish the artifact of each successful workflow run, with no CirCI step in the
                    workflow. The GitHub App needs the <Text variant="mono">Actions: read</Text>{' '}
                    permission.
                  </>
                ) : (
                  'Needs a linked GitHub repository.'
                )
              }
              checked={fromActions}
              onCheckedChange={setFromActions}
              disabled={!canManage || !githubLinked}
            />
            {fromActions ? (
              <>
                <TextField
                  label="Artifact name"
                  name="sitesArtifactName"
                  stacked
                  value={artifact}
                  disabled={!canManage}
                  error={artifactProblem}
                  onChange={(e) => {
                    setArtifact(e.target.value)
                    if (save.isError) save.reset()
                  }}
                  description={
                    <>
                      The <Text variant="mono">name</Text> of the{' '}
                      <Text variant="mono">actions/upload-artifact</Text> step.
                    </>
                  }
                />
                <TextField
                  label="Site name"
                  name="sitesArtifactSiteName"
                  stacked
                  value={siteName}
                  placeholder="site"
                  disabled={!canManage}
                  onChange={(e) => {
                    setSiteName(e.target.value)
                    if (save.isError) save.reset()
                  }}
                  description="Which of the project's sites this is, like circi site upload --name."
                />
              </>
            ) : null}
            {s.sitesFromActions && lastResult ? (
              <Banner tone={lastResult.status === 'published' ? 'success' : 'danger'}>
                {lastResult.message}
              </Banner>
            ) : null}
          </div>
        </SettingsRow>
      ) : null}
    </SectionForm>
  )
}
