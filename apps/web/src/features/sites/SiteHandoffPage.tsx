import { Spinner, Stack, Text } from '@circi/ui'
import { useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { AuthPanel } from '#features/auth/AuthPanel.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { RouterLink } from '#lib/router-link.ts'

import { requestSiteAccess } from './api.ts'

/**
 * Where a hosted site sends people to sign in (`/_sso/site?host=…&return=…`). Once they are
 * signed in to the dashboard (the app shows the sign-in page first if not), this asks for access
 * to that one address and goes back there. Anything that can't be opened, for whatever reason,
 * is the same "not found". Laid out like the sign-in page (docs/design-gaps.md §10).
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
    <AuthPanel
      title="Not found"
      description="This address doesn’t exist, or you don’t have access to it."
    >
      <RouterLink to="/">Go to teams</RouterLink>
    </AuthPanel>
  ) : (
    <AuthPanel title="Opening the site…">
      <Stack direction="row" gap={2} align="center">
        <Spinner />
        <Text tone="secondary">Checking your access.</Text>
      </Stack>
    </AuthPanel>
  )
}
