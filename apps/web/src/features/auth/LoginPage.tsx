import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { authMethodsQuery, setupQuery } from './api.ts'
import { AuthPage } from './AuthPage.tsx'
import { EmailForm } from './EmailForm.tsx'
import { readInvitedEmail, readLink } from './login-helpers.ts'
import { PasswordForm } from './PasswordForm.tsx'
import { SetupPage } from './SetupPage.tsx'
import { SsoButtons } from './SsoButtons.tsx'
import { WorkspaceSsoSignIn } from './WorkspaceSsoSignIn.tsx'

import styles from './AuthForms.module.css'

/**
 * Sign-in, outside the sidebar frame: one centred column on the page's glow (no card, no top
 * bar). Provider buttons first, then the email form: a password, or with email login on a
 * 6-digit code (or the link in the same mail). There's no sign-up link because accounts are
 * created by an administrator (`circi admin user create`) or by an invitation.
 */
export function LoginPage() {
  const setup = useQuery(setupQuery())
  const methods = useQuery(authMethodsQuery())
  const fromLink = readLink()
  const invitedEmail = readInvitedEmail()
  const passwordOn = methods.data?.password !== false
  const [mode, setMode] = useState<'password' | 'email'>(
    fromLink || invitedEmail ? 'email' : 'password',
  )
  const [workspaceStep, setWorkspaceStep] = useState(false)
  const emailOn = methods.data?.email === true || Boolean(fromLink) || Boolean(invitedEmail)
  const showsSignIn = setup.data !== undefined && !setup.data.needed

  // The tab says "Sign in to CirCI" (the setup page sets its own title).
  useEffect(() => {
    if (!showsSignIn) return undefined
    const before = document.title
    document.title = 'Sign in to CirCI'
    return () => {
      document.title = before
    }
  }, [showsSignIn])

  // Don't flash the sign-in form at someone who is about to see the setup page.
  if (setup.isPending) return null
  if (setup.data?.needed) return <SetupPage />

  const providers = methods.data?.sso ?? []

  return (
    <AuthPage
      title="Sign in to CirCI"
      subtitle={workspaceStep ? 'Sign in through your workspace' : window.location.host}
    >
      {workspaceStep ? (
        <WorkspaceSsoSignIn onBack={() => setWorkspaceStep(false)} />
      ) : (
        <>
          <SsoButtons providers={providers} onWorkspace={() => setWorkspaceStep(true)} />
          {/* Only between provider buttons and the form: "Continue with SSO" alone needs none. */}
          {providers.length > 0 ? <div className={styles.divider}>or with email</div> : null}
          {(mode === 'email' || !passwordOn) && emailOn ? (
            <EmailForm
              initial={fromLink}
              invitedEmail={invitedEmail}
              onBack={passwordOn ? () => setMode('password') : undefined}
            />
          ) : (
            <PasswordForm onEmail={emailOn ? () => setMode('email') : undefined} />
          )}
        </>
      )}
      <p className={styles.note}>
        Got an invitation? Open the link in the email to join your team.
      </p>
    </AuthPage>
  )
}
