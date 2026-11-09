import { Button, TextField } from '@circi/ui'
import { useState, type FormEvent } from 'react'

import { authClient } from '#lib/auth-client.ts'
import { useDocumentTitle } from '#lib/document-title.ts'

import { submitSetup } from './api.ts'
import { AuthPage } from './AuthPage.tsx'
import { BannerSlot } from './BannerSlot.tsx'
import { text } from './login-helpers.ts'

import styles from './AuthForms.module.css'

/**
 * Shown instead of the sign-in form while the instance has no accounts: creates the first one
 * (an instance admin) and its workspace. The setup code comes from the server's log.
 */
export function SetupPage() {
  useDocumentTitle('Set up')
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = text(form, 'email').trim()
    const password = text(form, 'password')
    setBusy(true)
    setError(undefined)
    try {
      await submitSetup({
        code: text(form, 'code').trim(),
        name: text(form, 'name').trim(),
        email,
        password,
        workspaceName: text(form, 'workspaceName').trim(),
      })
      // On success the session store updates and the app replaces this page by itself.
      await authClient.signIn.email({ email, password })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthPage
      title="Set up CirCI"
      subtitle="Create the first account, which becomes the instance admin, and its workspace."
    >
      <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
        <BannerSlot>{error}</BannerSlot>
        <TextField
          name="code"
          label="Setup code"
          size="lg"
          required
          autoFocus
          autoComplete="off"
          description="Printed in the server log at startup, or run: circi admin setup-code"
        />
        <TextField name="name" label="Your name" size="lg" required autoComplete="name" />
        <TextField
          name="email"
          type="email"
          label="Email"
          size="lg"
          placeholder="you@company.com"
          required
          autoComplete="username"
        />
        <TextField
          name="password"
          type="password"
          label="Password"
          size="lg"
          required
          autoComplete="new-password"
          description="At least 12 characters."
        />
        <TextField
          name="workspaceName"
          label="Workspace name"
          size="lg"
          placeholder="Acme"
          required
        />
        <Button type="submit" variant="primary" size="lg" loading={busy} className={styles.submit}>
          {busy ? 'Setting up…' : 'Create account'}
        </Button>
      </form>
    </AuthPage>
  )
}
