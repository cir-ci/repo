import { Badge, Banner, Button, Spinner, Text, TextField } from '@circi/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { AuthPage } from '#features/auth/AuthPage.tsx'
import { BannerSlot } from '#features/auth/BannerSlot.tsx'
import { checksQuery, FINDING_LEVEL } from '#features/instance/api/admin.ts'
import { capabilitiesQuery } from '#features/teams/api/index.ts'
import { useCreateTeam } from '#features/teams/api/new-team.ts'
import { DEFAULT_BRANCH } from '#features/teams/new-team.ts'
import { CreatedStep } from '#features/teams/NewTeamDialog.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { keys } from '#lib/query-keys.ts'
import { useSetupStore } from '#lib/stores/setup-store.ts'

import { useFinishSetup } from './api.ts'
import { storageFindings } from './setup-model.ts'
import { SetupProgress } from './SetupProgress.tsx'

import authStyles from '#features/auth/AuthForms.module.css'
import styles from './Setup.module.css'

/**
 * Steps 3 and 4 of first-run setup, for the signed-in instance admin, shown in place of the app
 * while the server says setup is pending (`capabilities.setupPending`) and until "Done" or "Skip".
 * A reload lands here again, at the storage check: what exists (the account, the workspace) is
 * not asked for twice.
 */
export function SetupContinue() {
  useDocumentTitle('Set up')
  const [step, setStep] = useState<3 | 4>(3)
  return (
    <AuthPage title="Set up CirCI" subtitle={<SetupProgress step={step} />} wide={step === 4}>
      {step === 3 ? (
        <StorageStep onContinue={() => setStep(4)} />
      ) : (
        <TeamStep onBack={() => setStep(3)} />
      )}
    </AuthPage>
  )
}

/** Step 3: what the server says about its storage (the doctor's storage check, which writes a test file). */
function StorageStep({ onContinue }: { onContinue: () => void }) {
  const checks = useQuery(checksQuery())
  const findings = checks.data ? storageFindings(checks.data) : []
  const checking = checks.isFetching
  return (
    <div className={authStyles.form}>
      {checking && findings.length === 0 ? (
        <div className={styles.checking}>
          <Spinner /> Checking storage…
        </div>
      ) : null}
      {checks.error && !checks.data ? (
        <Banner tone="danger">{`Couldn't check storage: ${checks.error.message}`}</Banner>
      ) : null}
      {findings.map((f) => (
        <div key={f.id + f.label} className={styles.finding}>
          <div className={styles.findingHead}>
            {f.label}
            <Badge shape="tag" tone="state" state={FINDING_LEVEL[f.level].state}>
              {FINDING_LEVEL[f.level].label}
            </Badge>
          </div>
          <p className={styles.findingText}>{f.detail}</p>
          {f.value ? (
            <Text as="code" variant="mono" className={styles.findingValue}>
              {f.value}
            </Text>
          ) : null}
          {f.fix ? <p className={styles.findingText}>{f.fix}</p> : null}
        </div>
      ))}
      <div className={styles.actions}>
        <Button size="lg" loading={checking} onClick={() => void checks.refetch()}>
          Check again
        </Button>
        <Button variant="primary" size="lg" onClick={onContinue}>
          Continue
        </Button>
      </div>
    </div>
  )
}

/** Step 4: the first team and its CI snippet, or skip it. */
function TeamStep({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data: caps } = useQuery(capabilitiesQuery())
  const create = useCreateTeam()
  const finish = useFinishSetup()
  const created = useSetupStore((s) => s.team)
  const hold = useSetupStore((s) => s.hold)
  const release = useSetupStore((s) => s.release)
  const [name, setName] = useState('')
  const [branch, setBranch] = useState(DEFAULT_BRANCH)
  const [nameError, setNameError] = useState<string | undefined>(undefined)
  const workspace = caps?.manageableWorkspaces[0]?.slug

  async function done() {
    // The cached capabilities are re-read first, so the app never sees a stale "setup pending".
    await queryClient.invalidateQueries({ queryKey: keys.capabilities() })
    release()
    if (created) {
      void navigate({
        to: '/$workspace/$team',
        params: { workspace: created.workspace, team: created.slug },
      })
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setNameError('Enter a name')
      return
    }
    if (!workspace) return
    setNameError(undefined)
    create.mutate(
      { workspace, name: name.trim(), defaultBranch: branch, repo: undefined },
      {
        onSuccess: (team) => {
          // The page stays until "Done" (the token is shown once); the server's setup ends now.
          hold(team)
          finish.mutate()
        },
      },
    )
  }

  if (created) {
    return (
      <div className={authStyles.form}>
        <CreatedStep created={created} />
        <div className={styles.actions}>
          <Button variant="primary" size="lg" onClick={() => void done()}>
            Done
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form className={authStyles.form} onSubmit={submit} noValidate>
      <BannerSlot>{create.error?.message}</BannerSlot>
      <TextField
        name="name"
        label="Team name"
        size="lg"
        required
        autoFocus
        autoComplete="off"
        placeholder="web-app"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={nameError}
      />
      <TextField
        name="defaultBranch"
        label="Default branch"
        size="lg"
        autoComplete="off"
        value={branch}
        onChange={(e) => setBranch(e.target.value)}
      />
      <div className={styles.actions}>
        <Button variant="ghost" size="lg" disabled={create.isPending} onClick={onBack}>
          Back
        </Button>
        <Button
          variant="link"
          disabled={create.isPending || finish.isPending}
          onClick={() => finish.mutate()}
        >
          Skip for now
        </Button>
        <Button type="submit" variant="primary" size="lg" loading={create.isPending}>
          Create team
        </Button>
      </div>
    </form>
  )
}
