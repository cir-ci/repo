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
import { ConnectBitbucket } from './ConnectBitbucket.tsx'
import { ConnectFigma } from './ConnectFigma.tsx'
import { ConnectForm } from './ConnectForm.tsx'
import { ConnectGitlab } from './ConnectGitlab.tsx'
import { ConnectTracker } from './ConnectTracker.tsx'
import { useInstall } from './generic-api.ts'
import { ProviderLogo } from './logos.tsx'
import { isTrackerKind, TRACKER_NAME, type TrackerKind } from './trackers-api.ts'

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
  const [connecting, setConnecting] = useState<'github' | 'gitlab' | 'bitbucket' | null>(null)
  const [tracker, setTracker] = useState<TrackerKind | null>(null)
  const [figma, setFigma] = useState(false)
  // A generic integration whose connect form is open (one with credential fields).
  const [generic, setGeneric] = useState<Integration.CatalogEntry | null>(null)
  const install = useInstall(props.org)
  const tiles = filterCatalog(props.catalog, { query, group })

  function close(open: boolean) {
    if (!open) {
      setConnecting(null)
      setTracker(null)
      setFigma(false)
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
      title={
        generic
          ? `Connect ${generic.name}`
          : figma
            ? 'Connect Figma'
            : tracker
              ? `Connect ${TRACKER_NAME[tracker]}`
              : connecting === 'github'
                ? 'Connect GitHub'
                : connecting === 'gitlab'
                  ? 'Connect GitLab'
                  : connecting === 'bitbucket'
                    ? 'Connect Bitbucket'
                    : 'Add an integration'
      }
      size="wide"
      actions={
        connecting || tracker || figma || generic ? (
          <Button
            onClick={() => {
              setConnecting(null)
              setTracker(null)
              setFigma(false)
              setGeneric(null)
            }}
          >
            Back
          </Button>
        ) : (
          <Button onClick={() => close(false)}>Close</Button>
        )
      }
    >
      {generic ? (
        <ConnectForm entry={generic} org={props.org} onDone={() => close(false)} />
      ) : figma ? (
        <ConnectFigma org={props.org} onDone={() => close(false)} />
      ) : tracker ? (
        <ConnectTracker kind={tracker} org={props.org} onDone={() => close(false)} />
      ) : connecting === 'github' ? (
        <ConnectGithub org={props.org} onDone={() => close(false)} />
      ) : connecting === 'gitlab' ? (
        <ConnectGitlab org={props.org} onDone={() => close(false)} />
      ) : connecting === 'bitbucket' ? (
        <ConnectBitbucket org={props.org} onDone={() => close(false)} />
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
                    {unavailableNote(entry) ?? entry.description}
                  </Text>
                  <Button
                    disabled={!canAdd(entry)}
                    onClick={() => {
                      if (entry.pageStyle === 'generic') {
                        // Nothing to type, only an install: go straight to the provider.
                        if (entry.credentials.length === 0 && entry.oauth) {
                          install.mutate(entry.kind)
                        } else setGeneric(entry)
                        return
                      }
                      if (isTrackerKind(entry.kind)) setTracker(entry.kind)
                      if (entry.kind === 'github') setConnecting('github')
                      if (entry.kind === 'gitlab') setConnecting('gitlab')
                      if (entry.kind === 'bitbucket') setConnecting('bitbucket')
                      if (entry.kind === 'figma') setFigma(true)
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

/** Only kinds with an add flow can be picked (every generic one has): planned and not-set-up ones are disabled. */
const canAdd = (entry: Integration.CatalogEntry) =>
  unavailableNote(entry) === null &&
  (entry.pageStyle === 'generic' ||
    entry.kind === 'github' ||
    entry.kind === 'gitlab' ||
    entry.kind === 'bitbucket' ||
    entry.kind === 'figma' ||
    isTrackerKind(entry.kind))

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
    <form onSubmit={submit} noValidate className={styles.form}>
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
