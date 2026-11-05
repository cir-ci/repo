import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useState, type FormEvent } from 'react'

import { useDocumentTitle } from '../../components.tsx'
import { authClient } from '../../lib/auth-client.ts'
import { submitSetup } from './api.ts'
import { text } from './login-helpers.ts'

/**
 * Shown instead of the sign-in form while the instance has no accounts: creates the first one
 * (an instance admin) and its organization. The setup code comes from the server's log.
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
        organizationName: text(form, 'organizationName').trim(),
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
    <Box sx={{ maxWidth: 360, mx: 'auto', mt: { xs: 4, md: 8 }, px: 2 }}>
      <Typography variant="h1" sx={{ textAlign: 'center', mb: 1 }}>
        Set up CirCI
      </Typography>
      <Typography color="text.secondary" sx={{ textAlign: 'center', mb: 3 }}>
        Create the first account, which becomes the instance admin, and its organization.
      </Typography>
      <Box component="form" onSubmit={(e) => void submit(e)} noValidate>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            name="code"
            label="Setup code"
            required
            autoFocus
            size="small"
            fullWidth
            autoComplete="off"
            helperText="Printed in the server log at startup, or run: circi admin setup-code"
          />
          <TextField
            name="name"
            label="Your name"
            required
            size="small"
            fullWidth
            autoComplete="name"
          />
          <TextField
            name="email"
            type="email"
            label="Email"
            required
            size="small"
            fullWidth
            autoComplete="username"
          />
          <TextField
            name="password"
            type="password"
            label="Password"
            required
            size="small"
            fullWidth
            autoComplete="new-password"
            helperText="At least 12 characters."
          />
          <TextField
            name="organizationName"
            label="Organization name"
            required
            size="small"
            fullWidth
          />
          <Button type="submit" variant="contained" disabled={busy} fullWidth>
            {busy ? 'Setting up…' : 'Create account'}
          </Button>
        </Stack>
      </Box>
    </Box>
  )
}
