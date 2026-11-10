import {
  Banner,
  Button,
  Dialog,
  FormDialog,
  SecretBox,
  Select,
  TabList,
  Text,
  TextField,
  WarningIcon,
} from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { type CreatedTeam, useCreateTeam, useRepoChoices } from '#features/teams/api/new-team.ts'
import { toast } from '#lib/toast.ts'
import { useCopy } from '#lib/use-copy.ts'

import {
  CI_EXAMPLES,
  type CiKey,
  DEFAULT_BRANCH,
  gateNote,
  NO_REPOSITORY,
  repoHelp,
  slugify,
} from './new-team.ts'
import { NewTeamMembers } from './NewTeamMembers.tsx'

import styles from './NewTeamDialog.module.css'

/**
 * New team, in two steps: its name, default branch and (optionally) repository; then the CI token,
 * shown once, with the CI examples to paste (GitHub Actions, GitLab CI, Bitbucket Pipelines,
 * Jenkins, Other) filled in for this team, each with a copy button. The second step can't be
 * dismissed by accident: the token isn't shown again.
 */
export function NewTeamDialog({
  open,
  onClose,
  workspaces,
  initialWorkspace,
}: NewTeamDialog.Props) {
  const create = useCreateTeam()
  const navigate = useNavigate()
  const [created, setCreated] = useState<CreatedTeam | null>(null)
  const [pickedWorkspace, setPickedWorkspace] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [branch, setBranch] = useState(DEFAULT_BRANCH)
  const [repoValue, setRepoValue] = useState(NO_REPOSITORY)
  const [nameError, setNameError] = useState<string | null>(null)
  const [memberIds, setMemberIds] = useState<string[]>([])
  const preferred = workspaces.find((w) => w.slug === initialWorkspace)?.slug
  const workspace = pickedWorkspace ?? preferred ?? workspaces[0]?.slug ?? ''
  const repos = useRepoChoices(workspace, open && !created)
  const repo = repos.find((r) => r.value === repoValue)

  function close() {
    const next = created
    setCreated(null)
    setName('')
    setBranch(DEFAULT_BRANCH)
    setRepoValue(NO_REPOSITORY)
    setPickedWorkspace(null)
    setNameError(null)
    setMemberIds([])
    create.reset()
    onClose()
    if (next)
      void navigate({
        to: '/$workspace/$team',
        params: { workspace: next.workspace, team: next.slug },
      })
  }

  function submit() {
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Enter a name')
      return
    }
    setNameError(null)
    create.mutate(
      { workspace, name: trimmed, defaultBranch: branch, repo, memberIds },
      {
        onSuccess: (team) => {
          setCreated(team)
          toast(`Created ${trimmed}`)
        },
      },
    )
  }

  if (created) {
    return (
      <Dialog
        open={open}
        onOpenChange={() => {}}
        title="Team created"
        description="Step 2 of 2"
        size="wide"
        hideClose
        dismissible={false}
        actions={
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        }
      >
        <CreatedStep created={created} />
      </Dialog>
    )
  }

  return (
    <FormDialog
      open={open}
      onClose={close}
      onSubmit={submit}
      title="New team"
      description="Step 1 of 2"
      submitLabel="Create team"
      cancelVariant="ghost"
      pending={create.isPending}
      noValidate
      formClassName={styles.form}
    >
      {workspaces.length > 1 ? (
        <Select
          name="workspace"
          label="Workspace"
          items={workspaces.map((w) => ({ value: w.slug, label: w.name }))}
          value={workspace}
          onValueChange={(next) => {
            setPickedWorkspace(next)
            setRepoValue(NO_REPOSITORY)
            setMemberIds([])
          }}
        />
      ) : null}
      <TextField
        name="name"
        label="Name"
        required
        autoFocus
        autoComplete="off"
        value={name}
        onChange={(e) => setName(e.target.value)}
        description={
          <>
            Address: <Text as="span" variant="mono">{`/${workspace}/${slugify(name)}`}</Text>
          </>
        }
        error={nameError}
      />
      <TextField
        name="defaultBranch"
        label="Default branch"
        autoComplete="off"
        value={branch}
        onChange={(e) => setBranch(e.target.value)}
        description="Builds on this branch become the baselines other branches compare with."
      />
      <Select
        name="repository"
        label="Link a repository (optional)"
        items={[
          { value: NO_REPOSITORY, label: 'No repository, use the CLI exit code as the gate' },
          ...repos.map((r) => ({ value: r.value, label: r.name })),
        ]}
        value={repoValue}
        onValueChange={setRepoValue}
        description={repoHelp(repo !== undefined)}
      />
      <NewTeamMembers workspace={workspace} value={memberIds} onChange={setMemberIds} />
      {create.error ? <Banner tone="danger">{create.error.message}</Banner> : null}
    </FormDialog>
  )
}

/** Step two: the token, once, and the CI examples with this team's details in them. */
export function CreatedStep({ created }: { created: CreatedTeam }) {
  const [ci, setCi] = useState<CiKey>('github')
  const { copy, state, reset } = useCopy()
  const context = {
    token: created.token,
    team: `${created.workspace}/${created.slug}`,
    apiUrl: location.origin,
  }
  const example = CI_EXAMPLES.find((e) => e.key === ci) ?? CI_EXAMPLES[0]
  if (!example) return null
  const snippet = example.snippet(context)

  return (
    <div className={styles.form}>
      <Text as="p" variant="small" tone="secondary">
        <strong>{created.name}</strong> is ready. Add this CI token to your CI as a secret named{' '}
        <Text as="code" variant="mono">
          CIRCI_TOKEN
        </Text>
        .
      </Text>
      <SecretBox label="CI token" value={created.token} />
      <p className={styles.once}>
        <WarningIcon size={14} />
        This is the only time the token is shown. If you lose it, rotate it in the team's CI token
        settings.
      </p>
      <Text as="p" variant="small" tone="secondary">
        Then, after your tests, upload the screenshots:
      </Text>
      <TabList
        label="CI system"
        tabs={CI_EXAMPLES.map((e) => ({ value: e.key, label: e.label }))}
        value={ci}
        onChange={(next) => {
          setCi(next)
          reset()
        }}
      >
        <div className={styles.snippetBox}>
          <pre className={styles.snippet}>{snippet}</pre>
          <Button
            size="sm"
            onClick={() => void copy(snippet)}
            aria-label={`Copy ${example.label} example`}
          >
            {state === 'copied' ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <Text as="p" variant="small" tone="tertiary">
          {example.note(context)}
        </Text>
        <Text as="p" variant="small" tone="tertiary">
          {gateNote(created.linked)}
        </Text>
      </TabList>
    </div>
  )
}

export namespace NewTeamDialog {
  export interface Props {
    open: boolean
    onClose: () => void
    /** Where the person may create teams. */
    workspaces: ReadonlyArray<{ slug: string; name: string }>
    /** The workspace to start on (the one the sidebar shows), if the person can create teams in it. */
    initialWorkspace?: string | undefined
  }
}
