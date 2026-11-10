import { Banner, Button, LockIcon } from '@circi/ui'
import { useState } from 'react'

import { authClient } from '#lib/auth-client.ts'

import { ssoErrorMessage } from './login-helpers.ts'
import { ProviderIcon } from './ProviderIcon.tsx'

import styles from './AuthForms.module.css'

/**
 * The buttons above the email form: one "Continue with <name>" per provider the operator set up
 * (GitHub, Google, OpenID Connect), then "Continue with SSO" for a workspace's own identity
 * provider, which opens the workspace step (`onWorkspace`).
 */
export function SsoButtons({ providers, onWorkspace }: SsoButtons.Props) {
  const [error, setError] = useState<string | undefined>(ssoErrorMessage)
  if (providers.length === 0 && !onWorkspace && !error) return null

  async function go(id: string) {
    setError(undefined)
    const options = { callbackURL: '/', errorCallbackURL: '/' }
    // The generic OpenID Connect provider is registered as a social provider too.
    const { error: failure } = await authClient.signIn.social({ provider: id, ...options })
    if (failure) setError("Couldn't reach that provider. Try again, or sign in another way.")
  }

  return (
    <div className={styles.providers}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {providers.map((p) => (
        <Button
          key={p.id}
          size="lg"
          className={styles.block}
          leading={<ProviderIcon id={p.id} />}
          onClick={() => void go(p.id)}
        >
          Continue with {p.name}
        </Button>
      ))}
      {onWorkspace ? (
        <Button size="lg" className={styles.block} leading={<LockIcon />} onClick={onWorkspace}>
          Continue with SSO
        </Button>
      ) : null}
    </div>
  )
}

export namespace SsoButtons {
  export interface Props {
    providers: { id: string; name: string }[]
    /** Opens the workspace step. Left out when workspace single sign-on isn't available. */
    onWorkspace?: (() => void) | undefined
  }
}
