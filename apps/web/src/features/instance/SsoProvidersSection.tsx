import type { InstanceAdmin } from '@circi/api'
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  FormDialog,
  Select,
  SettingsRow,
  SettingsSection,
  Text,
  TextField,
} from '@circi/ui'
import { useState } from 'react'

import { toast } from '#lib/toast.ts'

import { useRemoveSsoProvider, useSaveSsoProvider } from './api/admin.ts'
import { callbackAddress, PROVIDER_LABELS, type SecretDraft } from './config-model.ts'
import { SecretField } from './SecretField.tsx'

import styles from './Admin.module.css'

type Provider = InstanceAdmin.SsoProvider
const IDS: Provider['id'][] = ['github', 'google', 'gitlab', 'oidc']

/**
 * The single sign-on providers of the whole instance. Providers set by `AUTH_*` variables are
 * listed read-only; the others are added, changed and removed here, each in its own dialog (a
 * one-off action applies when confirmed, not with the page's Save).
 */
export function SsoProvidersSection({ providers, origin }: SsoProvidersSection.Props) {
  const [editing, setEditing] = useState<Provider | 'new' | null>(null)
  const [removing, setRemoving] = useState<Provider | null>(null)
  const remove = useRemoveSsoProvider()
  const free = IDS.filter((id) => !providers.some((p) => p.id === id))

  return (
    <SettingsSection
      title="Single sign-on providers"
      description="Everyone on the instance can use these. A workspace adds its own provider in its settings."
      actions={
        <Button variant="secondary" disabled={free.length === 0} onClick={() => setEditing('new')}>
          Add provider
        </Button>
      }
    >
      {providers.length === 0 ? (
        <SettingsRow label="No providers yet" />
      ) : (
        providers.map((p) => (
          <SettingsRow
            key={p.id}
            label={p.name}
            detail={`${PROVIDER_LABELS[p.id]}${p.issuer ? ` at ${p.issuer}` : ''}`}
            env={p.env ? `Set by ${p.env}` : undefined}
          >
            {p.source === 'env' ? (
              <Badge shape="tag">Read-only</Badge>
            ) : (
              <div className={styles.rowActions}>
                <Button variant="secondary" onClick={() => setEditing(p)}>
                  Edit
                </Button>
                <Button variant="ghost" onClick={() => setRemoving(p)}>
                  Remove
                </Button>
              </div>
            )}
          </SettingsRow>
        ))
      )}
      {editing ? (
        <ProviderDialog
          key={editing === 'new' ? 'new' : editing.id}
          provider={editing === 'new' ? null : editing}
          free={free}
          origin={origin}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title={`Remove ${removing?.name ?? 'the provider'}?`}
        description="People who sign in with it can no longer do so. Their accounts stay."
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => {
          if (!removing) return
          remove.mutate(removing.id, {
            onSuccess: () => {
              toast(`Removed ${removing.name}`)
              setRemoving(null)
            },
            onError: () => setRemoving(null),
          })
        }}
      />
    </SettingsSection>
  )
}

export namespace SsoProvidersSection {
  export interface Props {
    providers: Provider[]
    /** The dashboard address, for the callback to register at the provider. */
    origin: string
  }
}

function ProviderDialog({ provider, free, origin, onClose }: ProviderDialog.Props) {
  const save = useSaveSsoProvider()
  const [id, setId] = useState<Provider['id']>(provider?.id ?? free[0] ?? 'github')
  const [name, setName] = useState(provider?.name ?? '')
  const [clientId, setClientId] = useState(provider?.clientId ?? '')
  const [secret, setSecret] = useState<SecretDraft>({ mode: 'keep' })
  const [issuer, setIssuer] = useState(provider?.issuer ?? '')
  const [trusted, setTrusted] = useState(provider?.trustedForEmail ?? false)
  const [shown, setShown] = useState(false)
  const hasSecret = secret.mode === 'replace' ? secret.value !== '' : provider?.secretSaved === true
  const needsIssuer = id === 'oidc' || id === 'gitlab'
  const problems = {
    clientId: clientId.trim() ? undefined : 'Enter the client ID',
    secret: hasSecret ? undefined : 'Enter the client secret',
    issuer:
      id === 'oidc' && !/^https?:\/\/\S+$/.test(issuer.trim())
        ? 'Enter the issuer address, like https://login.acme.io'
        : undefined,
  }
  const invalid = Boolean(problems.clientId ?? problems.secret ?? problems.issuer)

  return (
    <FormDialog
      open
      initialFocus={() => document.getElementById(provider ? 'sso-client-id' : 'sso-provider')}
      onClose={onClose}
      title={provider ? `Edit ${provider.name}` : 'Add a single sign-on provider'}
      submitLabel={provider ? 'Save provider' : 'Add provider'}
      pending={save.isPending}
      noValidate
      formClassName={styles.form}
      onSubmit={() => {
        setShown(true)
        if (invalid) return
        save.mutate(
          {
            id,
            body: {
              ...(name.trim() ? { name: name.trim() } : {}),
              clientId: clientId.trim(),
              ...(secret.mode === 'replace' ? { clientSecret: secret.value } : {}),
              ...(needsIssuer && issuer.trim() ? { issuer: issuer.trim() } : {}),
              trustedForEmail: id === 'oidc' ? trusted : id !== 'gitlab',
            },
          },
          {
            onSuccess: () => {
              toast(
                provider ? `Saved ${provider.name}` : `Added ${name.trim() || PROVIDER_LABELS[id]}`,
              )
              onClose()
            },
          },
        )
      }}
    >
      {provider ? null : (
        <Select
          id="sso-provider"
          label="Provider"
          value={id}
          items={free.map((value) => ({ value, label: PROVIDER_LABELS[value] }))}
          onValueChange={(next) => {
            const found = IDS.find((value) => value === next)
            if (found) setId(found)
          }}
        />
      )}
      {id === 'oidc' ? (
        <TextField
          label="Name on the sign-in button"
          value={name}
          placeholder="Single sign-on"
          onChange={(e) => setName(e.target.value)}
        />
      ) : null}
      {needsIssuer ? (
        <TextField
          label={id === 'oidc' ? 'Issuer' : 'GitLab address'}
          value={issuer}
          placeholder={id === 'oidc' ? 'https://login.acme.io' : 'https://gitlab.acme.io'}
          error={shown ? problems.issuer : undefined}
          onChange={(e) => setIssuer(e.target.value)}
        />
      ) : null}
      <TextField
        id="sso-client-id"
        label="Client ID"
        value={clientId}
        error={shown ? problems.clientId : undefined}
        onChange={(e) => setClientId(e.target.value)}
      />
      <SecretField
        label="Client secret"
        saved={provider?.secretSaved === true}
        unreadable={provider?.unreadable}
        draft={secret}
        onChange={setSecret}
        error={shown ? problems.secret : undefined}
        removable={false}
      />
      {id === 'oidc' ? (
        <Checkbox
          label="This provider only reports addresses its people own"
          description="Lets a login attach to an existing account with the same email, and count towards a verified domain."
          checked={trusted}
          onCheckedChange={setTrusted}
        />
      ) : null}
      <Text variant="small" tone="secondary">
        Redirect address to register at the provider:{' '}
        <Text as="code" variant="mono">
          {callbackAddress(origin, id)}
        </Text>
      </Text>
    </FormDialog>
  )
}

namespace ProviderDialog {
  export interface Props {
    /** The provider being edited; null when adding. */
    provider: Provider | null
    /** The providers that are not set up yet. */
    free: Provider['id'][]
    origin: string
    onClose: () => void
  }
}
