import { Banner, Button, TextField } from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { isGitlabBaseUrl, useConnectGitlab } from './gitlab-api.ts'

import styles from './Integrations.module.css'

/**
 * The Add dialog's GitLab step: the GitLab address (gitlab.com or a self-managed instance) and an
 * access token with the `api` scope. The server asks GitLab who the token is and lists its
 * projects before it stores anything.
 */
export function ConnectGitlab(props: ConnectGitlab.Props) {
  const connect = useConnectGitlab(props.org)
  const navigate = useNavigate()
  const [baseUrl, setBaseUrl] = useState('https://gitlab.com')
  const [token, setToken] = useState('')
  const valid = isGitlabBaseUrl(baseUrl) && token.trim() !== ''

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    connect.mutate(
      { baseUrl, token },
      {
        onSuccess: () => {
          props.onDone()
          void navigate({
            to: '/organizations/$org/settings/integrations/gitlab',
            params: { org: props.org },
          })
        },
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <TextField
        label="GitLab address"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        required
        inputMode="url"
        placeholder="https://gitlab.com"
        description="gitlab.com, or the address of your self-managed GitLab."
        {...(baseUrl && !isGitlabBaseUrl(baseUrl)
          ? { error: 'Enter a full address such as https://gitlab.com' }
          : {})}
      />
      <TextField
        label="Access token"
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        required
        description="A project, group or personal access token with the api scope (role Developer or higher). It is stored encrypted."
      />
      {connect.error ? <Banner tone="danger">{connect.error.message}</Banner> : null}
      <div>
        <Button type="submit" variant="primary" loading={connect.isPending} disabled={!valid}>
          Connect GitLab
        </Button>
      </div>
    </form>
  )
}

export namespace ConnectGitlab {
  export interface Props {
    org: string
    onDone: () => void
  }
}
