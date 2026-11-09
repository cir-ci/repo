import { Button, TextField } from '@circi/ui'
import { useState, type FormEvent } from 'react'

import { authClient } from '#lib/auth-client.ts'

import { BannerSlot } from './BannerSlot.tsx'
import {
  clearLink,
  describeCodeFailure,
  describeFailure,
  RESEND_COOLDOWN_SECONDS,
  text,
} from './login-helpers.ts'
import { useCooldown } from './use-cooldown.ts'

import styles from './AuthForms.module.css'

async function send(address: string) {
  const { error: failure } = await authClient.emailOtp.sendVerificationOtp({
    email: address,
    type: 'sign-in',
  })
  return failure
}

/** Step 1: ask for a code. Step 2: type it (or arrive with it filled in from the mailed link). */
export function EmailForm({ initial, email, onEmailChange, onBack }: EmailForm.Props) {
  const [sent, setSent] = useState(Boolean(initial))
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const cooldown = useCooldown()

  async function request(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const address = email.trim()
    setBusy(true)
    setError(undefined)
    const failure = await send(address)
    setBusy(false)
    if (failure) return setError(describeFailure(failure))
    // Same step whether or not the address has an account: nothing to learn from here.
    onEmailChange(address)
    setNotice(undefined)
    setSent(true)
    cooldown.start(RESEND_COOLDOWN_SECONDS)
  }

  async function resend() {
    setResending(true)
    setError(undefined)
    setNotice(undefined)
    const failure = await send(email)
    setResending(false)
    if (failure) {
      setError(describeFailure(failure))
      // Rate limited: ask the person to wait rather than offering the button again at once.
      cooldown.start(failure.status === 429 ? 60 : RESEND_COOLDOWN_SECONDS)
      return
    }
    setNotice(`We sent a new code to ${email}. The earlier one no longer works.`)
    cooldown.start(RESEND_COOLDOWN_SECONDS)
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
    if (failure) setError(describeCodeFailure(failure))
    else clearLink()
  }

  if (!sent) {
    return (
      <form className={styles.form} onSubmit={(e) => void request(e)} noValidate>
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
        />
        <Button type="submit" variant="primary" size="lg" loading={busy} className={styles.submit}>
          {busy ? 'Sending…' : 'Email me a code'}
        </Button>
        <BannerSlot>{error}</BannerSlot>
        {onBack ? (
          <Button variant="link" className={styles.center} onClick={onBack}>
            Use a password instead
          </Button>
        ) : null}
      </form>
    )
  }

  return (
    <form className={styles.form} onSubmit={(e) => void confirm(e)} noValidate>
      {error ? (
        <BannerSlot>{error}</BannerSlot>
      ) : (
        <BannerSlot tone="info">
          {notice ??
            `If ${email} has an account, we sent it a 6-digit code. It works for 10 minutes.`}
        </BannerSlot>
      )}
      <TextField
        name="code"
        label="6-digit code"
        size="lg"
        defaultValue={initial?.code ?? ''}
        autoComplete="one-time-code"
        autoFocus
        required
        inputMode="numeric"
        pattern="[0-9 ]*"
        invalid={Boolean(error)}
      />
      <Button type="submit" variant="primary" size="lg" loading={busy} className={styles.submit}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
      <Button
        variant="link"
        className={styles.center}
        loading={resending}
        disabled={cooldown.left > 0 || resending}
        onClick={() => void resend()}
      >
        {cooldown.left > 0 ? `Send a new code in ${cooldown.left}s` : 'Send a new code'}
      </Button>
      <Button
        variant="link"
        className={styles.center}
        onClick={() => {
          clearLink()
          setError(undefined)
          setNotice(undefined)
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
    /** What is typed in the email field, kept by the page so it survives switching forms. */
    email: string
    onEmailChange: (email: string) => void
    onBack: (() => void) | undefined
  }
}
