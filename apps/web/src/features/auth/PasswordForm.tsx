import { Button, TextField } from '@circi/ui'
import { type FormEvent, useState } from 'react'

import { authClient } from '#lib/auth-client.ts'

import { BannerSlot } from './BannerSlot.tsx'
import { describeFailure, text } from './login-helpers.ts'

import styles from './AuthForms.module.css'

export function PasswordForm({ email, onEmailChange, onEmail }: PasswordForm.Props) {
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
    // On failure the fields keep what was typed: the form is the same element.
    if (failure) setError(describeFailure(failure))
  }

  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
      <TextField
        name="email"
        type="email"
        label="Email"
        size="lg"
        placeholder="you@company.com"
        value={email}
        onChange={(e) => onEmailChange(e.target.value)}
        autoComplete="username"
        autoFocus
        required
        invalid={Boolean(error)}
      />
      <TextField
        name="password"
        type="password"
        label="Password"
        size="lg"
        autoComplete="current-password"
        required
        invalid={Boolean(error)}
        labelAction={
          onEmail ? (
            <Button variant="link" onClick={onEmail}>
              Email me a code
            </Button>
          ) : undefined
        }
      />
      <Button type="submit" variant="primary" size="lg" loading={busy} className={styles.submit}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
      {/* Below the fields, so the room kept for an error doesn't read as a gap above them. */}
      <BannerSlot>{error}</BannerSlot>
    </form>
  )
}

export namespace PasswordForm {
  export interface Props {
    /** What is typed in the email field, kept by the page so it survives switching forms. */
    email: string
    onEmailChange: (email: string) => void
    /** Switches to the mailed code; the link shows only when email codes are available. */
    onEmail: (() => void) | undefined
  }
}
