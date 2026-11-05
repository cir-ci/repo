import { Box, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { useDocumentTitle } from '../../components.tsx'
import { authMethodsQuery, setupQuery } from './api.ts'
import { EmailForm } from './EmailForm.tsx'
import { readInvitedEmail, readLink } from './login-helpers.ts'
import { PasswordForm } from './PasswordForm.tsx'
import { SetupPage } from './SetupPage.tsx'
import { SsoButtons } from './SsoButtons.tsx'

/**
 * Sign-in, as a Primer interstitial page: centred, 320px wide, one task. There's no sign-up
 * link because accounts are created by an administrator (`circi admin user create`).
 * With email login on, a second way in: a 6-digit code (or the link in the same mail).
 */
export function LoginPage() {
  useDocumentTitle('Sign in')
  const setup = useQuery(setupQuery())
  const methods = useQuery(authMethodsQuery())
  const fromLink = readLink()
  const invitedEmail = readInvitedEmail()
  const passwordOn = methods.data?.password !== false
  const [mode, setMode] = useState<'password' | 'email'>(
    fromLink || invitedEmail ? 'email' : 'password',
  )
  const emailOn = methods.data?.email === true || Boolean(fromLink) || Boolean(invitedEmail)

  // Don't flash the sign-in form at someone who is about to see the setup page.
  if (setup.isPending) return null
  if (setup.data?.needed) return <SetupPage />

  return (
    <Box sx={{ maxWidth: 320, mx: 'auto', mt: { xs: 4, md: 10 }, px: 2 }}>
      <Typography variant="h1" sx={{ textAlign: 'center', mb: 3 }}>
        Sign in to CirCI
      </Typography>
      {(mode === 'email' || !passwordOn) && emailOn ? (
        <EmailForm
          initial={fromLink}
          invitedEmail={invitedEmail}
          onBack={passwordOn ? () => setMode('password') : undefined}
        />
      ) : (
        <PasswordForm onEmail={emailOn ? () => setMode('email') : undefined} />
      )}
      <SsoButtons providers={methods.data?.sso ?? []} />
      <Typography variant="body2" color="text.secondary" sx={{ mt: 3, textAlign: 'center' }}>
        No account? Ask the person who runs CirCI for one.
      </Typography>
    </Box>
  )
}
