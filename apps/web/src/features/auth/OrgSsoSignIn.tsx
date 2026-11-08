import { Banner, Button, TextField } from '@circi/ui'
import { type FormEvent, useState } from 'react'

import { post } from '../../lib/http.ts'

import styles from './AuthForms.module.css'

/**
 * Sign in through an organization's own identity provider: type the organization's name (its
 * short address name) and the browser goes to that provider.
 */
export function OrgSsoSignIn() {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const raw = new FormData(e.currentTarget).get('organization')
    const organizationSlug = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    setBusy(true)
    setError(undefined)
    try {
      const { url } = await post<{ url: string }>('/api/auth/sign-in/sso', {
        organizationSlug,
        callbackURL: '/',
        errorCallbackURL: '/',
      })
      window.location.assign(url)
    } catch {
      setError('That organization has no single sign-on set up.')
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" className={styles['center']} onClick={() => setOpen(true)}>
        Sign in through your organization
      </Button>
    )
  }
  return (
    <form
      className={`${styles['form']} ${styles['compact']}`}
      onSubmit={(e) => void submit(e)}
      noValidate
    >
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <TextField name="organization" label="Organization" placeholder="acme" required autoFocus />
      <Button type="submit" loading={busy} className={styles['block']}>
        Continue
      </Button>
    </form>
  )
}
