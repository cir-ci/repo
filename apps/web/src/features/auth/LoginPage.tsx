import { Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { useDocumentTitle } from '#lib/document-title.ts'

import { authMethodsQuery, setupQuery } from './api.ts'
import { AuthPanel } from './AuthPanel.tsx'
import { EmailForm } from './EmailForm.tsx'
import { readInvitedEmail, readLink } from './login-helpers.ts'
import { OrgSsoSignIn } from './OrgSsoSignIn.tsx'
import { PasswordForm } from './PasswordForm.tsx'
import { SetupPage } from './SetupPage.tsx'
import { SsoButtons } from './SsoButtons.tsx'

import styles from './AuthForms.module.css'

/**
 * Sign-in, outside the sidebar frame (docs/design-gaps.md §10): one centred panel, one task.
 * There's no sign-up link because accounts are created by an administrator
 * (`circi admin user create`). With email login on, a second way in: a 6-digit code (or the
 * link in the same mail).
 */
export function LoginPage() {
  const setup = useQuery(setupQuery())
  // The setup page takes over when no account exists yet: the tab title must say what is shown.
  useDocumentTitle(setup.data?.needed ? 'Set up' : 'Sign in')
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
    <AuthPanel title="Sign in to CirCI">
      {(mode === 'email' || !passwordOn) && emailOn ? (
        <EmailForm
          initial={fromLink}
          invitedEmail={invitedEmail}
          onBack={passwordOn ? () => setMode('password') : undefined}
        />
      ) : (
        <PasswordForm onEmail={emailOn ? () => setMode('email') : undefined} />
      )}
      <div className={styles.form}>
        <SsoButtons providers={methods.data?.sso ?? []} />
        <OrgSsoSignIn />
      </div>
      <Text as="p" variant="small" tone="secondary" className={styles.center}>
        No account? Ask the person who runs CirCI for one.
      </Text>
    </AuthPanel>
  )
}
