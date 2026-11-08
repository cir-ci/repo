import { Banner, Button, TextField } from '@circi/ui'
import { type FormEvent, useState } from 'react'

import { authClient } from '#lib/auth-client.ts'

import { describeFailure, text } from './login-helpers.ts'

import styles from './AuthForms.module.css'

export function PasswordForm({ onEmail }: PasswordForm.Props) {
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError(undefined)
    const { error: failure } = await authClient.signIn.email({
      email: text(form, 'email').trim(),
      password: text(form, 'password'),
    })
    setBusy(false)
    // On success the session store updates and the app replaces this page by itself.
    if (failure) setError(describeFailure(failure.status))
  }

  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <TextField
        name="email"
        type="email"
        label="Email"
        autoComplete="username"
        autoFocus
        required
      />
      <TextField
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" variant="primary" loading={busy} className={styles.block}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
      {onEmail ? (
        <Button variant="ghost" className={styles.center} onClick={onEmail}>
          Email me a code
        </Button>
      ) : null}
    </form>
  )
}

export namespace PasswordForm {
  export interface Props {
    onEmail: (() => void) | undefined
  }
}
