import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { type FormEvent, useState } from 'react'

import { authClient } from '../auth.ts'
import { useDocumentTitle } from '../components.tsx'

/**
 * Sign-in, as a Primer interstitial page: centred, 320px wide, one task. There's no sign-up
 * link because accounts are created by an administrator (`circi admin user create`).
 */
export function LoginPage() {
  useDocumentTitle('Sign in')
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = text(form, 'email').trim()
    const password = text(form, 'password')
    setBusy(true)
    setError(undefined)
    const { error: failure } = await authClient.signIn.email({ email, password })
    setBusy(false)
    // On success the session store updates and the app replaces this page by itself.
    if (failure) setError(describeFailure(failure.status))
  }

  return (
    <Box sx={{ maxWidth: 320, mx: 'auto', mt: { xs: 4, md: 10 }, px: 2 }}>
      <Typography variant="h1" sx={{ textAlign: 'center', mb: 3 }}>
        Sign in to CirCI
      </Typography>
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
        </Stack>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 3, textAlign: 'center' }}>
        No account? Ask the person who runs CirCI for one.
      </Typography>
    </Box>
  )
}

/** A form field's text (the browser could also give a File, which a text input never does). */
function text(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

/** Says what went wrong without helping anyone guess which emails have accounts. */
function describeFailure(status: number): string {
  if (status === 401 || status === 400) return 'Incorrect email or password.'
  if (status === 429) return 'Too many attempts. Wait a minute and try again.'
  return 'Couldn’t sign in. Check your connection and try again.'
}
