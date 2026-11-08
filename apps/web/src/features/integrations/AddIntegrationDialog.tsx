import type { Integration } from '@circi/api'
import { Badge, Banner, Button, Dialog, SegmentedControl, Text, TextField } from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import {
  type GroupFilter,
  filterCatalog,
  GROUPS,
  isGroupFilter,
  isInstallationId,
  unavailableNote,
  useConnectGithub,
} from './api.ts'
import { ProviderLogo } from './logos.tsx'

import styles from './Integrations.module.css'

const GROUP_OPTIONS = [{ value: 'all', label: 'All' }, ...GROUPS]

/**
 * Every integration CirCI knows, searchable and filterable by group. Planned ones are disabled.
 * Adding GitHub is the one flow built so far: it asks for the GitHub App installation id (the
 * number at the end of the installation's settings address on GitHub), as the project page did,
 * then opens GitHub's own integration page to choose repositories.
 */
export function AddIntegrationDialog(props: AddIntegrationDialog.Props) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<GroupFilter>('all')
  const [connecting, setConnecting] = useState<'github' | null>(null)
  const tiles = filterCatalog(props.catalog, { query, group })

  function close(open: boolean) {
    if (!open) {
      setConnecting(null)
      setQuery('')
      setGroup('all')
    }
    props.onOpenChange(open)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={close}
      title={connecting === 'github' ? 'Connect GitHub' : 'Add an integration'}
      size="wide"
      actions={
        connecting ? (
          <Button onClick={() => setConnecting(null)}>Back</Button>
        ) : (
          <Button onClick={() => close(false)}>Close</Button>
        )
      }
    >
      {connecting === 'github' ? (
        <ConnectGithub org={props.org} onDone={() => close(false)} />
      ) : (
        <>
          <div className={styles['filters']}>
            <TextField
              label="Search integrations"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <SegmentedControl
              label="Group"
              options={GROUP_OPTIONS}
              value={group}
              onChange={(v) => {
                if (isGroupFilter(v)) setGroup(v)
              }}
            />
          </div>
          {tiles.length === 0 ? (
            <Text tone="secondary">No integrations match “{query.trim()}”.</Text>
          ) : (
            <ul className={styles['tiles']} aria-label="Available integrations">
              {tiles.map((entry) => (
                <li key={entry.kind} className={styles['tile']} data-disabled={!canAdd(entry)}>
                  <div className={styles['tileHead']}>
                    <ProviderLogo kind={entry.kind} />
                    <Text className={styles['tileTitle']}>{entry.name}</Text>
                    {props.added.includes(entry.kind) ? <Badge shape="tag">Added</Badge> : null}
                    {entry.status === 'planned' ? <Badge shape="tag">Planned</Badge> : null}
                  </div>
                  <Text variant="small" tone="secondary">
                    {unavailableNote(entry) ?? entry.description}
                  </Text>
                  <Button
                    disabled={!canAdd(entry)}
                    onClick={() => {
                      if (entry.kind === 'github') setConnecting('github')
                    }}
                    aria-label={`Add ${entry.name}`}
                  >
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Dialog>
  )
}

/** Only kinds with an add flow can be picked: planned and not-set-up ones are disabled. */
const canAdd = (entry: Integration.CatalogEntry) =>
  unavailableNote(entry) === null && entry.kind === 'github'

function ConnectGithub(props: { org: string; onDone: () => void }) {
  const connect = useConnectGithub(props.org)
  const navigate = useNavigate()
  const [id, setId] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!isInstallationId(id)) return
    connect.mutate(id, {
      onSuccess: () => {
        props.onDone()
        void navigate({
          to: '/organizations/$org/settings/integrations/github',
          params: { org: props.org },
        })
      },
    })
  }

  return (
    <form onSubmit={submit} noValidate className={styles['form']}>
      <TextField
        label="GitHub App installation id"
        value={id}
        onChange={(e) => setId(e.target.value)}
        required
        inputMode="numeric"
        description="Install the CirCI GitHub App on your account or organisation, then paste the number at the end of the installation’s settings address on GitHub."
        {...(id && !isInstallationId(id) ? { error: 'The installation id is a number' } : {})}
      />
      {connect.error ? <Banner tone="danger">{connect.error.message}</Banner> : null}
      <div>
        <Button
          type="submit"
          variant="primary"
          loading={connect.isPending}
          disabled={!isInstallationId(id)}
        >
          Connect GitHub
        </Button>
      </div>
    </form>
  )
}

export namespace AddIntegrationDialog {
  export interface Props {
    org: string
    open: boolean
    onOpenChange: (open: boolean) => void
    catalog: Integration.CatalogEntry[]
    /** Kinds the organisation already has, tagged "Added". */
    added: string[]
  }
}
