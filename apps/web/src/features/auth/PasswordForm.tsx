import { Alert, Box, Button, Link, Stack, TextField } from '@mui/material'
import { useState, type FormEvent } from 'react'

import { authClient } from '../../lib/auth-client.ts'
import { describeFailure, text } from './login-helpers.ts'

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
    <Box component="form" onSubmit={(e) => void submit(e)} noValidate>
      <Stack spacing={2}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <TextField
          name="email"
          type="email"
          label="Email"
          autoComplete="username"
          autoFocus
          required
          size="small"
          fullWidth
        />
        <TextField
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          required
          size="small"
          fullWidth
        />
        <Button type="submit" variant="contained" size="medium" disabled={busy} fullWidth>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        {onEmail ? (
          <Link component="button" type="button" variant="body2" onClick={onEmail}>
            Email me a sign-in code instead
          </Link>
        ) : null}
      </Stack>
    </Box>
  )
}

export namespace PasswordForm {
  export interface Props {
    onEmail: (() => void) | undefined
  }
}
