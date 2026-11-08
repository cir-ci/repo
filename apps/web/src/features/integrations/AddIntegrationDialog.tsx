import type { Integration } from '@circi/api'
import { Badge, Banner, Button, Dialog, SegmentedControl, Text, TextField } from '@circi/ui'
import { useState } from 'react'

import { GithubAddPanel } from '#features/instance/GithubAddPanel.tsx'

import { type GroupFilter, filterCatalog, GROUPS, isGroupFilter, unavailableNote } from './api.ts'
import { ConnectForm } from './ConnectForm.tsx'
import { useInstall } from './generic-api.ts'
import { ProviderLogo } from './logos.tsx'

import styles from './Integrations.module.css'

const GROUP_OPTIONS = [{ value: 'all', label: 'All' }, ...GROUPS]

/**
 * Every integration CirCI knows, searchable and filterable by group. Planned ones are disabled.
 * Each built one is added the same way, from its definition: a form of the credentials it asks for
 * (GitHub: the App installation id; GitLab and Bitbucket: an address or workspace and a token), or
 * straight to the provider's install when there is nothing to type.
 */
export function AddIntegrationDialog(props: AddIntegrationDialog.Props) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<GroupFilter>('all')
  // A generic integration whose connect form is open (one with credential fields).
  const [generic, setGeneric] = useState<Integration.CatalogEntry | null>(null)
  const install = useInstall(props.workspace)
  const tiles = filterCatalog(props.catalog, { query, group })

  function close(open: boolean) {
    if (!open) {
      setGeneric(null)
      setQuery('')
      setGroup('all')
    }
    props.onOpenChange(open)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={close}
      title={generic ? `Connect ${generic.name}` : 'Add an integration'}
      size="wide"
      actions={
        generic ? (
          <Button onClick={() => setGeneric(null)}>Back</Button>
        ) : (
          <Button onClick={() => close(false)}>Close</Button>
        )
      }
    >
      {generic ? (
        generic.kind === 'github' ? (
          <GithubAddPanel entry={generic} workspace={props.workspace} onDone={() => close(false)} />
        ) : (
          <ConnectForm entry={generic} workspace={props.workspace} onDone={() => close(false)} />
        )
      ) : (
        <>
          <div className={styles.filters}>
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
          {install.error ? <Banner tone="danger">{install.error.message}</Banner> : null}
          {tiles.length === 0 ? (
            <Text tone="secondary">No integrations match “{query.trim()}”.</Text>
          ) : (
            <ul className={styles.tiles} aria-label="Available integrations">
              {tiles.map((entry) => (
                <li key={entry.kind} className={styles.tile} data-disabled={!canAdd(entry)}>
                  <div className={styles.tileHead}>
                    <ProviderLogo kind={entry.logo} />
                    <Text className={styles.tileTitle}>{entry.name}</Text>
                    {props.added.includes(entry.kind) ? <Badge shape="tag">Added</Badge> : null}
                    {entry.status === 'planned' ? <Badge shape="tag">Planned</Badge> : null}
                  </div>
                  <Text variant="small" tone="secondary">
                    {(canAdd(entry) ? null : unavailableNote(entry)) ?? entry.description}
                  </Text>
                  <Button
                    disabled={!canAdd(entry)}
                    onClick={() => {
                      // Nothing to type, only an install: go straight to the provider.
                      if (entry.credentials.length === 0 && entry.oauth) {
                        install.mutate(entry.kind)
                      } else setGeneric(entry)
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

/** Only built, set-up kinds can be picked: planned and not-set-up ones are disabled. */
const canAdd = (entry: Integration.CatalogEntry) =>
  unavailableNote(entry) === null || (entry.kind === 'github' && entry.built)

export namespace AddIntegrationDialog {
  export interface Props {
    workspace: string
    open: boolean
    onOpenChange: (open: boolean) => void
    catalog: Integration.CatalogEntry[]
    /** Kinds the workspace already has, tagged "Added". */
    added: string[]
  }
}
