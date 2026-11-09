import {
  Banner,
  Button,
  ConfirmDialog,
  SettingsRow,
  SettingsSection,
  StatusChip,
  Text,
  TextField,
  useAnnounce,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { workspaceSsoQuery, useWorkspaceSso } from '#features/members/api.ts'
import { QuerySkeleton } from '#lib/QueryBoundary.tsx'

import { validateSso } from './model.ts'

import styles from './WorkspaceSso.module.css'

type Problems = ReturnType<typeof validateSso>

/**
 * The workspace's own OpenID Connect provider. People it signs in join this workspace and
 * can open nothing else; the workspace's name is how they find it on the sign-in page.
 */
export function WorkspaceSso({ workspace }: WorkspaceSso.Props) {
  const { data, error, refetch } = useQuery(workspaceSsoQuery(workspace))
  const { register, remove } = useWorkspaceSso(workspace)
  const announce = useAnnounce()
  const [problems, setProblems] = useState<Problems>({})
  const [removing, setRemoving] = useState<{ providerId: string; issuer: string } | null>(null)
  const failure = register.error ?? remove.error
  const providers = data?.providers ?? []

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const field = (k: string) => {
      const v = new FormData(form).get(k)
      return typeof v === 'string' ? v.trim() : ''
    }
    const input = {
      issuer: field('issuer'),
      clientId: field('clientId'),
      clientSecret: field('clientSecret'),
    }
    const found = validateSso(input)
    setProblems(found)
    if (Object.keys(found).length > 0) return
    await register.mutateAsync(input).then(
      () => {
        form.reset()
        announce('Single sign-on provider connected')
      },
      () => {},
    )
  }

  const clear = (name: keyof Problems) => () => setProblems((p) => ({ ...p, [name]: undefined }))

  const ready = data !== undefined && !error

  return (
    <>
      <SettingsSection
        title="Single sign-on"
        description={`Connect your own OpenID Connect provider (Okta, Entra ID, Keycloak…). People sign in from the sign-in page with “${workspace}” and join as members. Their session opens this workspace only, and an address that already has an account elsewhere is refused.`}
        bare={!ready}
      >
        {error ? (
          <Banner
            tone="danger"
            action={
              <Button size="sm" onClick={() => void refetch()}>
                Try again
              </Button>
            }
          >
            Couldn’t load the single sign-on settings: {error.message}
          </Banner>
        ) : !data ? (
          <QuerySkeleton rows={1} />
        ) : (
          <>
            {providers.map((p) => (
              <SettingsRow
                key={p.providerId}
                label={p.issuer}
                detail={
                  <>
                    Redirect address to register at the provider:{' '}
                    <Text as="code" variant="mono">
                      {p.redirectUri}
                    </Text>
                  </>
                }
              >
                <StatusChip status="approved">Connected</StatusChip>
                <Button
                  size="sm"
                  variant="danger"
                  aria-label={`Remove ${p.issuer}`}
                  onClick={() => setRemoving({ providerId: p.providerId, issuer: p.issuer })}
                >
                  Remove
                </Button>
              </SettingsRow>
            ))}
            {providers.length === 0 ? (
              <SettingsRow>
                <form onSubmit={(e) => void submit(e)} noValidate className={styles.form}>
                  <TextField
                    name="issuer"
                    label="Issuer address"
                    placeholder="https://login.example.com"
                    required
                    error={problems.issuer}
                    onChange={clear('issuer')}
                  />
                  <TextField
                    name="clientId"
                    label="Client id"
                    required
                    autoComplete="off"
                    error={problems.clientId}
                    onChange={clear('clientId')}
                  />
                  <TextField
                    name="clientSecret"
                    label="Client secret"
                    type="password"
                    required
                    // `off` is ignored for password fields: a password manager would fill in the
                    // user's own login here. `new-password` tells it this is a new secret.
                    autoComplete="new-password"
                    error={problems.clientSecret}
                    onChange={clear('clientSecret')}
                  />
                  <div>
                    <Button type="submit" loading={register.isPending}>
                      Connect provider
                    </Button>
                  </div>
                </form>
              </SettingsRow>
            ) : null}
          </>
        )}
      </SettingsSection>
      {failure ? <Banner tone="danger">{failure.message}</Banner> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title="Disconnect single sign-on?"
        description={`People who sign in through ${removing?.issuer ?? 'this provider'} will no longer be able to open ${workspace}. Their accounts stay until you remove them as members.`}
        confirmLabel="Remove provider"
        loading={remove.isPending}
        onConfirm={() => {
          if (removing) {
            remove.mutate(removing.providerId, {
              onSuccess: () => announce('Single sign-on provider removed'),
              onSettled: () => setRemoving(null),
            })
          }
        }}
      />
    </>
  )
}

export namespace WorkspaceSso {
  export interface Props {
    workspace: string
  }
}
