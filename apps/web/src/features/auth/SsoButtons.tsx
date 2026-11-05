import { Alert, Button, Stack } from '@mui/material'
import { useState } from 'react'

import { authClient } from '../../lib/auth-client.ts'

/** What the sign-in page says when a provider login came back refused. */
function ssoErrorMessage(): string | undefined {
  const code = new URLSearchParams(window.location.search).get('error')
  if (!code) return undefined
  return code.toLowerCase().includes('link')
    ? 'That sign-in provider isn’t trusted to attach to an existing account. Sign in another way, then ask whoever runs CirCI.'
    : 'Signing in with that provider didn’t work. If you have no account yet, ask to be invited.'
}

/** One button per single sign-on provider the operator set up. */
export function SsoButtons({ providers }: SsoButtons.Props) {
  const [error, setError] = useState<string | undefined>(ssoErrorMessage)
  if (providers.length === 0 && !error) return null

  async function go(id: string) {
    setError(undefined)
    const options = { callbackURL: '/', errorCallbackURL: '/' }
    // The generic OpenID Connect provider is registered as a social provider too.
    const { error: failure } = await authClient.signIn.social({ provider: id, ...options })
    if (failure) setError('Couldn’t reach that provider. Try again, or sign in another way.')
  }

  return (
    <Stack spacing={1.5} sx={{ mt: 3 }}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {providers.map((p) => (
        <Button key={p.id} variant="outlined" fullWidth onClick={() => void go(p.id)}>
          Continue with {p.name}
        </Button>
      ))}
    </Stack>
  )
}

export namespace SsoButtons {
  export interface Props {
    providers: { id: string; name: string }[]
  }
}
