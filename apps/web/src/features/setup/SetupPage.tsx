import { slugify } from '@circi/core'
import { Banner, Button, TextField } from '@circi/ui'
import { useState, type FormEvent } from 'react'

import { AuthPage } from '#features/auth/AuthPage.tsx'
import { authClient } from '#lib/auth-client.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { HttpError } from '#lib/http.ts'
import { useSetupStore } from '#lib/stores/setup-store.ts'

import { checkSetupCode, submitSetup } from './api.ts'
import {
  type AccountDraft,
  type AccountErrors,
  validateAccount,
  validateWorkspace,
  type WorkspaceDraft,
  type WorkspaceErrors,
  workspaceSlug,
} from './setup-model.ts'
import { SetupProgress } from './SetupProgress.tsx'
import { useAnnounceStep, useFocusFirstInvalid } from './use-step-a11y.ts'

import authStyles from '#features/auth/AuthForms.module.css'
import styles from './Setup.module.css'

/**
 * First-run setup while the instance has no accounts: the first two of four steps. Step 1 is the
 * account (the setup code from the server's log, which becomes the instance admin), step 2 the
 * workspace. Nothing exists on the server until step 2 is submitted, and then the account and
 * the workspace are made as one request, so a reload before that simply starts again and one
 * after it never lands here (the instance has an account). Steps 3 and 4 follow signed in
 * (`SetupContinue`), and are resumed from the server's state if the page is reloaded.
 */
export function SetupPage() {
  useDocumentTitle('Set up')
  const [step, setStep] = useState<1 | 2>(1)
  const [account, setAccount] = useState<AccountDraft>({
    code: '',
    name: '',
    email: '',
    password: '',
  })
  const [workspace, setWorkspace] = useState<WorkspaceDraft>({ name: '', slug: '' })
  const [accountErrors, setAccountErrors] = useState<AccountErrors>({})
  const [workspaceErrors, setWorkspaceErrors] = useState<WorkspaceErrors>({})
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const { formRef, focusInvalid } = useFocusFirstInvalid()
  useAnnounceStep(step)

  async function continueFromAccount(e: FormEvent) {
    e.preventDefault()
    const errors = validateAccount(account)
    setAccountErrors(errors)
    setError(undefined)
    if (Object.keys(errors).length > 0) {
      focusInvalid()
      return
    }
    setBusy(true)
    try {
      // The code is the only thing the server can know is wrong this early.
      await checkSetupCode(account.code.trim())
      setStep(2)
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) {
        setAccountErrors({ code: err.message })
        focusInvalid()
      } else setError(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setBusy(false)
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    const errors = validateWorkspace(workspace)
    setWorkspaceErrors(errors)
    setError(undefined)
    if (Object.keys(errors).length > 0) {
      focusInvalid()
      return
    }
    setBusy(true)
    try {
      await submitSetup({
        code: account.code.trim(),
        name: account.name.trim(),
        email: account.email.trim(),
        password: account.password,
        workspaceName: workspace.name.trim(),
        workspaceSlug: workspaceSlug(workspace),
      })
      // The account exists now: signing in swaps this page for steps 3 and 4.
      useSetupStore.getState().arrive()
      await authClient.signIn.email({ email: account.email.trim(), password: account.password })
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) {
        // The code was good a step ago: it was changed, so the first step is where to fix it.
        setAccountErrors({ code: err.message })
        setStep(1)
      } else {
        setError(err instanceof Error ? err.message : 'Setup failed')
      }
    } finally {
      setBusy(false)
    }
  }

  const followedSlug = slugify(workspace.name)

  return (
    <AuthPage compact title="Set up CirCI" subtitle={<SetupProgress step={step} />}>
      {step === 1 ? (
        <form
          key="account"
          ref={formRef}
          className={authStyles.form}
          onSubmit={(e) => void continueFromAccount(e)}
          noValidate
        >
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <TextField
            name="code"
            label="Setup code"
            size="lg"
            required
            autoFocus
            autoComplete="off"
            value={account.code}
            onChange={(e) => setAccount({ ...account, code: e.target.value })}
            error={accountErrors.code}
            description="Printed in the server log at startup, or run: circi admin setup-code"
          />
          <TextField
            name="name"
            label="Your name"
            size="lg"
            required
            autoComplete="name"
            value={account.name}
            onChange={(e) => setAccount({ ...account, name: e.target.value })}
            error={accountErrors.name}
          />
          <TextField
            name="email"
            type="email"
            label="Email"
            size="lg"
            placeholder="you@company.com"
            required
            autoComplete="username"
            value={account.email}
            onChange={(e) => setAccount({ ...account, email: e.target.value })}
            error={accountErrors.email}
          />
          <TextField
            name="password"
            type="password"
            label="Password"
            size="lg"
            required
            autoComplete="new-password"
            value={account.password}
            onChange={(e) => setAccount({ ...account, password: e.target.value })}
            error={accountErrors.password}
            description="At least 12 characters."
          />
          <div className={styles.actions}>
            <Button type="submit" variant="primary" size="lg" loading={busy}>
              Continue
            </Button>
          </div>
        </form>
      ) : (
        <form
          key="workspace"
          ref={formRef}
          className={authStyles.form}
          onSubmit={(e) => void create(e)}
          noValidate
        >
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <TextField
            name="workspaceName"
            label="Workspace name"
            size="lg"
            placeholder="Acme"
            required
            autoFocus
            autoComplete="organization"
            value={workspace.name}
            onChange={(e) => setWorkspace({ ...workspace, name: e.target.value })}
            error={workspaceErrors.name}
          />
          <TextField
            name="workspaceSlug"
            label="Address"
            size="lg"
            autoComplete="off"
            placeholder="acme"
            value={workspace.slug === '' ? followedSlug : workspace.slug}
            onChange={(e) => setWorkspace({ ...workspace, slug: e.target.value })}
            error={workspaceErrors.slug}
          />
          <div className={styles.actions}>
            <Button
              variant="ghost"
              size="lg"
              disabled={busy}
              onClick={() => {
                setError(undefined)
                setStep(1)
              }}
            >
              Back
            </Button>
            <Button type="submit" variant="primary" size="lg" loading={busy}>
              {busy ? 'Setting up…' : 'Continue'}
            </Button>
          </div>
        </form>
      )}
    </AuthPage>
  )
}
