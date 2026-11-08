import { Banner, Button, TextField } from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import {
  isJiraSite,
  type TrackerKind,
  TRACKER_NAME,
  useConnectJira,
  useConnectLinear,
} from './trackers-api.ts'

import styles from './Integrations.module.css'

/**
 * The Add dialog's Linear or Jira step. The server checks the credentials with the tracker
 * before it stores anything, then the person lands on the page where projects are mapped.
 */
export function ConnectTracker({ kind, org, onDone }: ConnectTracker.Props) {
  return kind === 'linear' ? (
    <ConnectLinear org={org} onDone={onDone} />
  ) : (
    <ConnectJira org={org} onDone={onDone} />
  )
}

function useAfterConnect(kind: TrackerKind, org: string, onDone: () => void) {
  const navigate = useNavigate()
  return () => {
    onDone()
    void navigate({
      to:
        kind === 'linear'
          ? '/organizations/$org/settings/integrations/linear'
          : '/organizations/$org/settings/integrations/jira',
      params: { org },
    })
  }
}

function ConnectLinear({ org, onDone }: Omit<ConnectTracker.Props, 'kind'>) {
  const connect = useConnectLinear(org)
  const done = useAfterConnect('linear', org, onDone)
  const [apiKey, setApiKey] = useState('')
  const valid = apiKey.trim() !== ''

  function submit(e: FormEvent) {
    e.preventDefault()
    if (valid) connect.mutate({ apiKey }, { onSuccess: done })
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <TextField
        label="Linear API key"
        type="password"
        autoComplete="off"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        required
        description="A personal API key (Linear settings, Security and access, Personal API keys). Issues are created as that person. It is stored encrypted."
      />
      {connect.error ? <Banner tone="danger">{connect.error.message}</Banner> : null}
      <div>
        <Button type="submit" variant="primary" loading={connect.isPending} disabled={!valid}>
          Connect Linear
        </Button>
      </div>
    </form>
  )
}

function ConnectJira({ org, onDone }: Omit<ConnectTracker.Props, 'kind'>) {
  const connect = useConnectJira(org)
  const done = useAfterConnect('jira', org, onDone)
  const [siteUrl, setSiteUrl] = useState('')
  const [email, setEmail] = useState('')
  const [apiToken, setApiToken] = useState('')
  const valid = isJiraSite(siteUrl) && email.trim() !== '' && apiToken.trim() !== ''

  function submit(e: FormEvent) {
    e.preventDefault()
    if (valid) connect.mutate({ siteUrl, email, apiToken }, { onSuccess: done })
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <TextField
        label="Jira site"
        value={siteUrl}
        onChange={(e) => setSiteUrl(e.target.value)}
        required
        placeholder="acme.atlassian.net"
        description="The address of your Jira Cloud site."
        {...(siteUrl && !isJiraSite(siteUrl) ? { error: 'Use your site’s host name' } : {})}
      />
      <TextField
        label="Account email"
        type="email"
        autoComplete="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <TextField
        label="API token"
        type="password"
        autoComplete="off"
        value={apiToken}
        onChange={(e) => setApiToken(e.target.value)}
        required
        description="An Atlassian API token for that account (id.atlassian.com, Security, API tokens). Issues are created as that account. It is stored encrypted."
      />
      {connect.error ? <Banner tone="danger">{connect.error.message}</Banner> : null}
      <div>
        <Button type="submit" variant="primary" loading={connect.isPending} disabled={!valid}>
          Connect {TRACKER_NAME.jira}
        </Button>
      </div>
    </form>
  )
}

export namespace ConnectTracker {
  export interface Props {
    kind: TrackerKind
    org: string
    onDone: () => void
  }
}
