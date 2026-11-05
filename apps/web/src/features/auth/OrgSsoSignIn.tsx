import { Alert, Box, Button, Link, Stack, TextField } from '@mui/material'
import { type FormEvent, useState } from 'react'

import { post } from '../../lib/http.ts'

/**
 * Sign in through an organization's own identity provider: type the organization's name (its
 * short address name) and the browser goes to that provider.
 */
export function OrgSsoSignIn() {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const raw = new FormData(e.currentTarget).get('organization')
    const organizationSlug = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    setBusy(true)
    setError(undefined)
    try {
      const { url } = await post<{ url: string }>('/api/auth/sign-in/sso', {
        organizationSlug,
        callbackURL: '/',
        errorCallbackURL: '/',
      })
      window.location.assign(url)
    } catch {
      setError('That organization has no single sign-on set up.')
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Box sx={{ mt: 2, textAlign: 'center' }}>
        <Link component="button" type="button" variant="body2" onClick={() => setOpen(true)}>
          Sign in through your organization
        </Link>
      </Box>
    )
  }
  return (
    <Box component="form" onSubmit={(e) => void submit(e)} noValidate sx={{ mt: 2 }}>
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <TextField
          name="organization"
          label="Organization"
          placeholder="acme"
          required
          autoFocus
          size="small"
          fullWidth
        />
        <Button type="submit" variant="outlined" disabled={busy} fullWidth>
          Continue
        </Button>
      </Stack>
    </Box>
  )
}
