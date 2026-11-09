import type { Integration } from '@circi/api'
import { Banner, Button, TextField } from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { credentialsComplete, credentialValues, useConnect, useInstall } from './api/generic.ts'

import styles from './Integrations.module.css'

/**
 * The Add dialog's connect step for any generic integration, rendered from the definition's
 * credential fields: a text field per field (a password field for a secret one) and, when the
 * integration has an OAuth install, a button for it. The server checks the values with the provider
 * before it stores anything; then the person lands on the integration's page.
 */
export function ConnectForm({ entry, workspace, onDone }: ConnectForm.Props) {
  const connect = useConnect(workspace, entry.kind)
  const install = useInstall(workspace)
  const navigate = useNavigate()
  const [values, setValues] = useState<Record<string, string>>({})
  const complete = credentialsComplete(entry.credentials, values)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!complete) return
    connect.mutate(credentialValues(entry.credentials, values), {
      onSuccess: ({ id }) => {
        onDone()
        void navigate({
          to: '/workspaces/$workspace/settings/integrations/$kind/$id',
          params: { workspace, kind: entry.kind, id },
        })
      },
    })
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form} aria-label={`Connect ${entry.name}`}>
      {entry.credentials.map((field) => (
        <TextField
          key={field.name}
          label={field.label}
          value={values[field.name] ?? ''}
          onChange={(e) => setValues((cur) => ({ ...cur, [field.name]: e.target.value }))}
          required={!field.optional}
          autoComplete="off"
          {...(field.secret ? { type: 'password' as const } : {})}
          {...(field.description ? { description: field.description } : {})}
          {...(field.placeholder ? { placeholder: field.placeholder } : {})}
        />
      ))}
      {connect.error ? <Banner tone="danger">{connect.error.message}</Banner> : null}
      {install.error ? <Banner tone="danger">{install.error.message}</Banner> : null}
      <div className={styles.trailing}>
        {entry.credentials.length > 0 ? (
          <Button type="submit" variant="primary" loading={connect.isPending} disabled={!complete}>
            Connect {entry.name}
          </Button>
        ) : null}
        {entry.oauth ? (
          <Button
            variant={entry.credentials.length > 0 ? 'secondary' : 'primary'}
            loading={install.isPending}
            onClick={() => install.mutate(entry.kind)}
          >
            {entry.credentials.length > 0
              ? `Install ${entry.name} instead`
              : `Connect ${entry.name}`}
          </Button>
        ) : null}
      </div>
    </form>
  )
}

export namespace ConnectForm {
  export interface Props {
    entry: Integration.CatalogEntry
    workspace: string
    onDone: () => void
  }
}
