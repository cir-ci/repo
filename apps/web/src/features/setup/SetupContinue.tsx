import { Badge, Banner, Button, Spinner, Text, TextField, useAnnounce } from '@circi/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { AuthPage } from '#features/auth/AuthPage.tsx'
import { checksQuery, FINDING_LEVEL } from '#features/instance/api/admin.ts'
import { capabilitiesQuery } from '#features/projects/api/index.ts'
import { useCreateProject } from '#features/projects/api/new-project.ts'
import { DEFAULT_BRANCH } from '#features/projects/new-project.ts'
import { CreatedStep } from '#features/projects/NewProjectDialog.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { keys } from '#lib/query-keys.ts'
import { useSetupStore } from '#lib/stores/setup-store.ts'

import { useFinishSetup } from './api.ts'
import { stepAnnouncement, storageFindings } from './setup-model.ts'
import { SetupProgress } from './SetupProgress.tsx'
import { useAnnounceStep, useFocusFirstInvalid } from './use-step-a11y.ts'

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
  // Only the created project's token and snippet need the wide column, not the project form.
  const created = useSetupStore((s) => s.project)
  const titleRef = useRef<HTMLHeadingElement>(null)
  // The account page this replaces had focus on a button that is gone: focus goes to the title
  // (step 3 has no field; step 4's name field takes it when it mounts). Step 3 announces itself
  // with its result (`StorageStep`), step 4 here.
  useAnnounceStep(step)
  useEffect(() => {
    if (step === 3) titleRef.current?.focus()
  }, [step])
  return (
    <AuthPage
      compact
      title="Set up CirCI"
      titleRef={titleRef}
      subtitle={<SetupProgress step={step} />}
      wide={step === 4 && created !== undefined}
    >
      {step === 3 ? (
        <StorageStep onContinue={() => setStep(4)} />
      ) : (
        <ProjectStep onBack={() => setStep(3)} />
      )}
    </AuthPage>
  )
}

/** Step 3: what the server says about its storage (the doctor's storage check, which writes a test file). */
function StorageStep({ onContinue }: { onContinue: () => void }) {
  const checks = useQuery(checksQuery())
  const findings = checks.data ? storageFindings(checks.data) : []
  const checking = checks.isFetching
  const announce = useAnnounce()
  // The result of each check is spoken: the findings change in place and have no live region of their
  // own. The first one also says the step (one message at a time, so the two are one sentence).
  const summary = findings.map((f) => `${f.label}: ${FINDING_LEVEL[f.level].label}`).join('. ')
  const opened = useRef(false)
  const checkedAt = checks.dataUpdatedAt
  useEffect(() => {
    // Each finished check is spoken, also one with the same result (`checkedAt` says it ran again).
    if (!summary || checkedAt === 0) return
    announce(opened.current ? summary : `${stepAnnouncement(3)}. ${summary}`)
    opened.current = true
  }, [summary, checkedAt, announce])
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

/** Step 4: the first project and its CI snippet, or skip it. */
function ProjectStep({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data: caps } = useQuery(capabilitiesQuery())
  const create = useCreateProject()
  const finish = useFinishSetup()
  const created = useSetupStore((s) => s.project)
  const hold = useSetupStore((s) => s.hold)
  const release = useSetupStore((s) => s.release)
  const [name, setName] = useState('')
  const [branch, setBranch] = useState(DEFAULT_BRANCH)
  const [nameError, setNameError] = useState<string | undefined>(undefined)
  const workspace = caps?.manageableWorkspaces[0]?.slug
  const { formRef, focusInvalid } = useFocusFirstInvalid()
  const createdRef = useRef<HTMLDivElement>(null)
  const announce = useAnnounce()
  // The form this replaces had focus: move it to the new content, which holds the token shown once.
  const hasCreated = created !== undefined
  useEffect(() => {
    if (!hasCreated) return
    createdRef.current?.focus()
    announce('Project created. The CI token is shown only once.')
  }, [hasCreated, announce])

  async function done() {
    // The cached capabilities are re-read first, so the app never sees a stale "setup pending".
    await queryClient.invalidateQueries({ queryKey: keys.capabilities() })
    release()
    if (created) {
      void navigate({
        to: '/$workspace/$project',
        params: { workspace: created.workspace, project: created.slug },
      })
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setNameError('Enter a name')
      focusInvalid()
      return
    }
    if (!workspace) return
    setNameError(undefined)
    create.mutate(
      { workspace, name: name.trim(), defaultBranch: branch, repo: undefined },
      {
        onSuccess: (project) => {
          // The page stays until "Done" (the token is shown once); the server's setup ends now.
          hold(project)
          finish.mutate()
        },
      },
    )
  }

  if (created) {
    return (
      <div ref={createdRef} tabIndex={-1} className={`${authStyles.form} ${styles.created}`}>
        <CreatedStep created={created} compact />
        <div className={styles.actions}>
          <Button variant="primary" size="lg" onClick={() => void done()}>
            Done
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form ref={formRef} className={authStyles.form} onSubmit={submit} noValidate>
      {create.error ? <Banner tone="danger">{create.error.message}</Banner> : null}
      <TextField
        name="name"
        label="Project name"
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
          Create project
        </Button>
      </div>
    </form>
  )
}
