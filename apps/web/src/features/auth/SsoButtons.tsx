import { Banner, Button } from '@circi/ui'
import { useState } from 'react'

import { authClient } from '#lib/auth-client.ts'

import { ssoErrorMessage } from './login-helpers.ts'

import styles from './AuthForms.module.css'

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
    <div className={`${styles.form} ${styles.compact}`}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {providers.map((p) => (
        <Button key={p.id} className={styles.block} onClick={() => void go(p.id)}>
          Continue with {p.name}
        </Button>
      ))}
    </div>
  )
}

export namespace SsoButtons {
  export interface Props {
    providers: { id: string; name: string }[]
  }
}
