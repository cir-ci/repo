import { Box, Typography } from '@mui/material'
import { useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { RouterLink, useDocumentTitle } from '../../components.tsx'
import { Blankslate } from '../../primitives/Blankslate.tsx'
import { requestSiteAccess } from './api.ts'

/**
 * Where a hosted site sends people to sign in (`/_sso/site?host=…&return=…`). Once they are
 * signed in to the dashboard (the app shows the sign-in page first if not), this asks for access
 * to that one address and goes back there. Anything that can't be opened, for whatever reason,
 * is the same "not found".
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
    <Blankslate
      icon={<span aria-hidden>404</span>}
      heading="Not found"
      description="This address doesn’t exist, or you don’t have access to it."
      primaryAction={<RouterLink to="/">Go to projects</RouterLink>}
    />
  ) : (
    <Box sx={{ textAlign: 'center', mt: 8 }}>
      <Typography color="text.secondary">Opening the site…</Typography>
    </Box>
  )
}
