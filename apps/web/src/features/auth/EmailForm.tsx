import { Banner, Button, TextField } from '@circi/ui'
import { useState, type FormEvent } from 'react'

import { authClient } from '#lib/auth-client.ts'

import { clearLink, describeCodeFailure, describeFailure, text } from './login-helpers.ts'

import styles from './AuthForms.module.css'

/** Step 1: ask for a code. Step 2: type it (or arrive with it filled in from the mailed link). */
export function EmailForm({ initial, invitedEmail, onBack }: EmailForm.Props) {
  const [email, setEmail] = useState(initial?.email ?? '')
  const [sent, setSent] = useState(Boolean(initial))
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  async function request(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const address = text(new FormData(e.currentTarget), 'email').trim()
    setBusy(true)
    setError(undefined)
    const { error: failure } = await authClient.emailOtp.sendVerificationOtp({
      email: address,
      type: 'sign-in',
    })
    setBusy(false)
    if (failure) return setError(describeFailure(failure.status))
    // Same step whether or not the address has an account: nothing to learn from here.
    setEmail(address)
    setSent(true)
  }

  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    const { error: failure } = await authClient.signIn.emailOtp({
      email,
      otp: text(new FormData(e.currentTarget), 'code').replaceAll(/\s/g, ''),
    })
    setBusy(false)
    if (failure) setError(describeCodeFailure(failure.status))
    else clearLink()
  }

  if (!sent) {
    return (
      <form className={styles.form} onSubmit={(e) => void request(e)} noValidate>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <TextField
          name="email"
          type="email"
          label="Email"
          defaultValue={invitedEmail ?? ''}
          autoComplete="username"
          autoFocus
          required
        />
        <Button type="submit" variant="primary" loading={busy} className={styles.block}>
          {busy ? 'Sending…' : 'Email me a code'}
        </Button>
        {onBack ? (
          <Button variant="ghost" className={styles.center} onClick={onBack}>
            Use a password instead
          </Button>
        ) : null}
      </form>
    )
  }

  return (
    <form className={styles.form} onSubmit={(e) => void confirm(e)} noValidate>
      <Banner tone="info">
        If {email} has an account, we sent it a 6-digit code. It works for 10 minutes.
      </Banner>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <TextField
        name="code"
        label="6-digit code"
        defaultValue={initial?.code ?? ''}
        autoComplete="one-time-code"
        autoFocus
        required
        inputMode="numeric"
        pattern="[0-9 ]*"
      />
      <Button type="submit" variant="primary" loading={busy} className={styles.block}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
      <Button
        variant="ghost"
        className={styles.center}
        onClick={() => {
          clearLink()
          setSent(false)
        }}
      >
        Use a different email
      </Button>
    </form>
  )
}

export namespace EmailForm {
  export interface Props {
    initial: { email: string; code: string } | undefined
    /** From an invitation link: the address that was invited, to save typing it. */
    invitedEmail: string | undefined
    onBack: (() => void) | undefined
  }
}
