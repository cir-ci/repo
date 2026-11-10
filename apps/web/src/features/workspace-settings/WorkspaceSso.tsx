import {
  Banner,
  Button,
  ConfirmDialog,
  Dialog,
  FormDialog,
  SettingsRow,
  StatusChip,
  Text,
  TextField,
  useAnnounce,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { workspaceSsoQuery, useWorkspaceSso } from '#features/members/api.ts'

import { validateSso } from './model.ts'

import styles from './WorkspaceSso.module.css'

type Problems = ReturnType<typeof validateSso>

/**
 * The "Single sign-on" row of the sign-in methods: the workspace's own OpenID Connect provider,
 * "Connected" with a Configure button. Configure opens a dialog: the form to connect a provider,
 * or, once one is connected, its issuer, the redirect address to register and Remove. People it
 * signs in join this workspace and can open nothing else; the workspace's name is how they find
 * it on the sign-in page. Render it inside the methods' `SettingsSection`.
 */
export function WorkspaceSso({ workspace }: WorkspaceSso.Props) {
  const { data, error, refetch } = useQuery(workspaceSsoQuery(workspace))
  const { register, remove } = useWorkspaceSso(workspace)
  const announce = useAnnounce()
  const [problems, setProblems] = useState<Problems>({})
  const [configuring, setConfiguring] = useState(false)
  const [removing, setRemoving] = useState(false)
  const provider = data?.providers[0]

  async function submit(e: FormEvent<HTMLFormElement>) {
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
        setConfiguring(false)
        announce('Single sign-on provider connected')
      },
      () => {},
    )
  }

  const clear = (name: keyof Problems) => () => setProblems((p) => ({ ...p, [name]: undefined }))

  function close() {
    setConfiguring(false)
    setProblems({})
    register.reset()
  }

  if (error) {
    return (
      <SettingsRow>
        <Banner
          tone="danger"
          action={
            <Button size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        >
          Couldn't load the single sign-on settings: {error.message}
        </Banner>
      </SettingsRow>
    )
  }

  return (
    <>
      <SettingsRow
        label="Single sign-on"
        detail={
          !data
            ? 'Loading…'
            : provider
              ? `${provider.issuer}. Signs people into ${workspace} only.`
              : 'Your own OpenID Connect provider (Okta, Entra ID, Keycloak…). Signs people into this workspace only.'
        }
      >
        {provider ? <StatusChip status="approved">Connected</StatusChip> : null}
        <Button size="sm" disabled={!data} onClick={() => setConfiguring(true)}>
          Configure
        </Button>
      </SettingsRow>
      {data && !provider ? (
        <FormDialog
          open={configuring}
          onClose={close}
          title="Single sign-on"
          description={`Connect your own OpenID Connect provider. People sign in from the sign-in page with “${workspace}” and join as members. Their session opens this workspace only, and an address that already has an account elsewhere is refused.`}
          submitLabel="Connect provider"
          pending={register.isPending}
          noValidate
          formClassName={styles.form}
          onSubmit={(e) => void submit(e)}
        >
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
            label="Client ID"
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
          {register.error ? <Banner tone="danger">{register.error.message}</Banner> : null}
        </FormDialog>
      ) : null}
      {provider ? (
        <Dialog
          open={configuring}
          onOpenChange={(open) => {
            if (!open) close()
          }}
          title="Single sign-on"
          description={`${provider.issuer} is connected. People who sign in through it join ${workspace} as members.`}
          actions={
            <>
              <Button
                variant="danger"
                aria-label={`Remove ${provider.issuer}`}
                onClick={() => setRemoving(true)}
              >
                Remove
              </Button>
              <Button onClick={close}>Done</Button>
            </>
          }
        >
          <Text variant="small" tone="secondary">
            Redirect address to register at the provider:{' '}
            <Text as="code" variant="mono">
              {provider.redirectUri}
            </Text>
          </Text>
          {remove.error ? <Banner tone="danger">{remove.error.message}</Banner> : null}
        </Dialog>
      ) : null}
      <ConfirmDialog
        open={removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(false)
        }}
        title="Remove single sign-on?"
        description={`People who sign in through ${provider?.issuer ?? 'this provider'} will no longer be able to open ${workspace}. Their accounts stay until you remove them as members.`}
        confirmLabel="Remove provider"
        loading={remove.isPending}
        onConfirm={() => {
          if (provider) {
            remove.mutate(provider.providerId, {
              onSuccess: () => {
                setConfiguring(false)
                announce('Single sign-on provider removed')
              },
              onSettled: () => setRemoving(false),
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
