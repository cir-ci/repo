import { Frame } from '#features/workspace-settings/Frame.tsx'
import { authClient } from '#lib/auth-client.ts'
import { useDocumentTitle } from '#lib/document-title.ts'

import { LinkedAccounts } from './LinkedAccounts.tsx'
import { PasswordSection } from './PasswordSection.tsx'
import { SessionsSection } from './SessionsSection.tsx'
import { YouSection } from './YouSection.tsx'

/** Your account: name, the accounts you sign in with, your password, and where you're signed in. */
export function ProfilePage() {
  const { data: current } = authClient.useSession()
  useDocumentTitle('Profile')
  return (
    <Frame crumbs={['Account', 'Profile']} loading={!current}>
      {current ? (
        <>
          <YouSection key={current.user.id} user={current.user} />
          <LinkedAccounts />
          <PasswordSection />
          <SessionsSection currentToken={current.session.token} />
        </>
      ) : null}
    </Frame>
  )
}
