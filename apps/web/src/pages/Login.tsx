import { Alert, Box, Button, Link, Stack, TextField, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'

import { getJson } from '../api.ts'
import { authClient } from '../auth.ts'
import { useDocumentTitle } from '../components.tsx'

/**
 * Sign-in, as a Primer interstitial page: centred, 320px wide, one task. There's no sign-up
 * link because accounts are created by an administrator (`circi admin user create`).
 * With email login on, a second way in: a 6-digit code (or the link in the same mail).
 */
export function LoginPage() {
  useDocumentTitle('Sign in')
  const methods = useQuery({
    queryKey: ['auth-methods'],
    queryFn: () => getJson<{ password: boolean; email: boolean }>('/api/auth-methods'),
    staleTime: 5 * 60_000,
  })
  const fromLink = readLink()
  const [mode, setMode] = useState<'password' | 'email'>(fromLink ? 'email' : 'password')
  const emailOn = methods.data?.email === true || Boolean(fromLink)

  return (
    <Box sx={{ maxWidth: 320, mx: 'auto', mt: { xs: 4, md: 10 }, px: 2 }}>
      <Typography variant="h1" sx={{ textAlign: 'center', mb: 3 }}>
        Sign in to CirCI
      </Typography>
      {mode === 'email' && emailOn ? (
        <EmailForm initial={fromLink} onBack={() => setMode('password')} />
      ) : (
        <PasswordForm onEmail={emailOn ? () => setMode('email') : undefined} />
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 3, textAlign: 'center' }}>
        No account? Ask the person who runs CirCI for one.
      </Typography>
    </Box>
  )
}

function PasswordForm({ onEmail }: { onEmail: (() => void) | undefined }) {
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

/** Step 1: ask for a code. Step 2: type it (or arrive with it filled in from the mailed link). */
function EmailForm({
  initial,
  onBack,
}: {
  initial: { email: string; code: string } | undefined
  onBack: () => void
}) {
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
            autoComplete="username"
            autoFocus
            required
            size="small"
            fullWidth
          />
          <Button type="submit" variant="contained" disabled={busy} fullWidth>
            {busy ? 'Sending…' : 'Email me a code'}
          </Button>
          <Link component="button" type="button" variant="body2" onClick={onBack}>
            Use a password instead
          </Link>
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

/**
 * The mailed link opens `/#signin-email=…&code=…`. It's in the fragment so servers never see it,
 * and nothing is submitted until the person clicks, so mail scanners can't spend the code.
 */
function readLink(): { email: string; code: string } | undefined {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const email = params.get('signin-email')
  const code = params.get('code')
  return email && code ? { email, code } : undefined
}

function clearLink(): void {
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
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

function describeCodeFailure(status: number): string {
  if (status === 429) return 'Too many attempts. Wait a minute and try again.'
  if (status === 400 || status === 401 || status === 403) {
    return 'That code is wrong or has expired. Check it, or ask for a new one.'
  }
  return 'Couldn’t sign in. Check your connection and try again.'
}
