import { Button, TextField } from '@circi/ui'
import { type FormEvent, useState } from 'react'

import { post } from '#lib/http.ts'

import { BannerSlot } from './BannerSlot.tsx'

import styles from './AuthForms.module.css'

/**
 * The "Continue with SSO" step: type the workspace's name (its short address name) and the
 * browser goes to that workspace's identity provider.
 */
export function WorkspaceSsoSignIn({ onBack }: WorkspaceSsoSignIn.Props) {
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const raw = new FormData(e.currentTarget).get('workspace')
    const workspaceSlug = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    setBusy(true)
    setError(undefined)
    try {
      const { url } = await post<{ url: string }>('/api/auth/sign-in/sso', {
        organizationSlug: workspaceSlug,
        callbackURL: '/',
        errorCallbackURL: '/',
      })
      window.location.assign(url)
    } catch {
      setError('That workspace has no single sign-on set up.')
      setBusy(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
      <BannerSlot>{error}</BannerSlot>
      <TextField
        name="workspace"
        label="Workspace"
        size="lg"
        placeholder="acme"
        description="The short name in your workspace’s address."
        required
        autoFocus
        invalid={Boolean(error)}
      />
      <Button type="submit" variant="primary" size="lg" loading={busy} className={styles.submit}>
        Continue
      </Button>
      <Button variant="link" className={styles.center} onClick={onBack}>
        Back to sign in
      </Button>
    </form>
  )
}

export namespace WorkspaceSsoSignIn {
  export interface Props {
    /** Returns to the main sign-in step. */
    onBack: () => void
  }
}
