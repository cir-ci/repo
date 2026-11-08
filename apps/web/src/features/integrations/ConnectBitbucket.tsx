import { Banner, Button, TextField } from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { isBitbucketWorkspace, useConnectBitbucket } from './api.ts'

import styles from './Integrations.module.css'

/**
 * The Add dialog's Bitbucket step: the workspace id and an access token (a workspace or
 * repository access token, or an app password with its username). The server checks the token by
 * listing the workspace's repositories before it stores anything.
 */
export function ConnectBitbucket(props: ConnectBitbucket.Props) {
  const connect = useConnectBitbucket(props.org)
  const navigate = useNavigate()
  const [workspace, setWorkspace] = useState('')
  const [token, setToken] = useState('')
  const [username, setUsername] = useState('')
  const valid = isBitbucketWorkspace(workspace) && token.trim() !== ''

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    connect.mutate(
      { workspace, token, username },
      {
        onSuccess: () => {
          props.onDone()
          void navigate({
            to: '/organizations/$org/settings/integrations/bitbucket',
            params: { org: props.org },
          })
        },
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <TextField
        label="Bitbucket workspace"
        value={workspace}
        onChange={(e) => setWorkspace(e.target.value)}
        required
        placeholder="acme"
        description="The workspace id: the part after bitbucket.org/ in its address."
        {...(workspace && !isBitbucketWorkspace(workspace)
          ? { error: 'Use letters, numbers, dashes and underscores' }
          : {})}
      />
      <TextField
        label="Access token"
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        required
        description="A workspace or repository access token that can read repositories and pull requests and write commit statuses and pull request comments. It is stored encrypted."
      />
      <TextField
        label="Username (app passwords only)"
        autoComplete="off"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        description="Leave empty for an access token. With an app password, enter the Bitbucket username it belongs to."
      />
      {connect.error ? <Banner tone="danger">{connect.error.message}</Banner> : null}
      <div>
        <Button type="submit" variant="primary" loading={connect.isPending} disabled={!valid}>
          Connect Bitbucket
        </Button>
      </div>
    </form>
  )
}

export namespace ConnectBitbucket {
  export interface Props {
    org: string
    onDone: () => void
  }
}
