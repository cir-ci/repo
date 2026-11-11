import { Button, Spinner } from '@circi/ui'
import { useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { AuthPage } from '#features/auth/AuthPage.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'

import { requestSiteAccess } from './api.ts'

import styles from './SiteHandoffPage.module.css'

/**
 * Where a hosted site sends people to sign in (`/_sso/site?host=…&return=…`). Once they are
 * signed in to the dashboard (the app shows the sign-in page first if not), this asks for access
 * to that one address and goes back there. Anything that can't be opened, for whatever reason,
 * is the same "not found". Laid out like the sign-in page.
 */
export function SiteHandoffPage() {
  const { host, return: returnPath } = useSearch({ from: '/_sso/site' })
  const [refused, setRefused] = useState(false)
  // No address to open is the same "not found", worked out here rather than in the effect.
  const failed = refused || !host
  useDocumentTitle('Opening site')

  useEffect(() => {
    if (!host) return
    requestSiteAccess(host, returnPath ?? '/').then(
      ({ url }) => window.location.replace(url),
      () => setRefused(true),
    )
  }, [host, returnPath])

  return failed ? (
    <AuthPage
      title="Not found"
      subtitle="This address doesn't exist, or you don't have access to it."
    >
      <Button href="/" size="lg" className={styles.back}>
        Go to projects
      </Button>
    </AuthPage>
  ) : (
    <AuthPage title="Opening the site…" subtitle={host}>
      <div role="status" className={styles.status}>
        <Spinner />
        Checking your access.
      </div>
    </AuthPage>
  )
}
