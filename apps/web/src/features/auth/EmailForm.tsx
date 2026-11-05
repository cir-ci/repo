import { Alert, Box, Button, Link, Stack, TextField } from '@mui/material'
import { useState, type FormEvent } from 'react'

import { authClient } from '../../lib/auth-client.ts'
import { clearLink, describeCodeFailure, describeFailure, text } from './login-helpers.ts'

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
      <Box component="form" onSubmit={(e) => void request(e)} noValidate>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            name="email"
            type="email"
            label="Email"
            defaultValue={invitedEmail ?? ''}
            autoComplete="username"
            autoFocus
            required
            size="small"
            fullWidth
          />
          <Button type="submit" variant="contained" disabled={busy} fullWidth>
            {busy ? 'Sending…' : 'Email me a code'}
          </Button>
          {onBack ? (
            <Link component="button" type="button" variant="body2" onClick={onBack}>
              Use a password instead
            </Link>
          ) : null}
        </Stack>
      </Box>
    )
  }

  return (
    <Box component="form" onSubmit={(e) => void confirm(e)} noValidate>
      <Stack spacing={2}>
        <Alert severity="info">
          If {email} has an account, we sent it a 6-digit code. It works for 10 minutes.
        </Alert>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <TextField
          name="code"
          label="6-digit code"
          defaultValue={initial?.code ?? ''}
          autoComplete="one-time-code"
          autoFocus
          required
          size="small"
          fullWidth
          slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9 ]*' } }}
        />
        <Button type="submit" variant="contained" disabled={busy} fullWidth>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <Link
          component="button"
          type="button"
          variant="body2"
          onClick={() => {
            clearLink()
            setSent(false)
          }}
        >
          Use a different email
        </Link>
      </Stack>
    </Box>
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
