import { Banner, Button, TextField } from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { isFigmaToken, useConnectFigma } from './figma-api.ts'

import styles from './Integrations.module.css'

/**
 * The Add dialog's Figma step: a personal access token (or an OAuth token). The server asks Figma
 * who it belongs to before storing it, encrypted; the dashboard never sees it again.
 */
export function ConnectFigma(props: ConnectFigma.Props) {
  const connect = useConnectFigma(props.org)
  const navigate = useNavigate()
  const [token, setToken] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!isFigmaToken(token)) return
    connect.mutate(token, {
      onSuccess: () => {
        props.onDone()
        void navigate({
          to: '/organizations/$org/settings/integrations/figma',
          params: { org: props.org },
        })
      },
    })
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <TextField
        label="Figma access token"
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        required
        description="A personal access token from Figma (Settings, Security) with read access to files and comments. It is stored encrypted."
      />
      {connect.error ? <Banner tone="danger">{connect.error.message}</Banner> : null}
      <div>
        <Button
          type="submit"
          variant="primary"
          loading={connect.isPending}
          disabled={!isFigmaToken(token)}
        >
          Connect Figma
        </Button>
      </div>
    </form>
  )
}

export namespace ConnectFigma {
  export interface Props {
    org: string
    onDone: () => void
  }
}
