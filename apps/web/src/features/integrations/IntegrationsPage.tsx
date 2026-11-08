import type { Integration } from '@circi/api'
import {
  Badge,
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  ListRow,
  SectionHeader,
  Text,
  useAnnounce,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearch } from '@tanstack/react-router'
import { useState } from 'react'

import { Frame } from '#features/settings/Frame.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'

import { AddIntegrationDialog } from './AddIntegrationDialog.tsx'
import {
  groupItems,
  integrationLabel,
  integrationsQuery,
  teamCountLabel,
  useRemoveIntegration,
} from './api.ts'
import { connectNote } from './generic-api.ts'
import { ProviderLogo } from './logos.tsx'

import styles from './Integrations.module.css'

/**
 * Workspace settings › Integrations: what the workspace has connected, under its group
 * headings. Teams have no integration settings of their own; each integration's page says which
 * teams use it. Owners and admins add and remove; everyone else can look.
 */
export function IntegrationsPage() {
  const { workspace } = useParams({ from: '/workspaces/$workspace/settings/integrations' })
  useDocumentTitle('Integrations', workspace)
  const search: { connect?: unknown; kind?: unknown } = useSearch({ strict: false })
  const { data, error, refetch } = useQuery(integrationsQuery(workspace))
  const remove = useRemoveIntegration(workspace)
  const announce = useAnnounce()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Integration.Item | null>(null)
  const groups = data ? groupItems(data.integrations) : []
  // An OAuth install that did not finish lands here (a finished one lands on the new page).
  const failedKind = typeof search.kind === 'string' ? search.kind : ''
  const note = connectNote(
    search.connect,
    data?.catalog.find((e) => e.kind === failedKind)?.name ?? failedKind,
  )

  return (
    <Frame
      crumbs={[workspace, 'Integrations']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This workspace doesn’t exist"
      readOnlyNote={
        data && !data.canManage && 'Only owners and admins can add or remove integrations.'
      }
    >
      {data ? (
        <>
          <section className={styles.groups}>
            <div className={styles.head}>
              <SectionHeader
                title="Integrations"
                description={`Tools connected to ${workspace}. Each integration’s settings say which teams use it and how.`}
              />
              {data.canManage ? (
                <Button variant="primary" onClick={() => setAdding(true)}>
                  Add integration
                </Button>
              ) : null}
            </div>
            {note && search.connect !== 'connected' ? (
              <Banner tone={note.tone}>{note.text}</Banner>
            ) : null}
            {remove.error ? <Banner tone="danger">{remove.error.message}</Banner> : null}
            {groups.length === 0 ? (
              <EmptyState title="No integrations yet">
                Add a git host so pull requests show their visual review status.
              </EmptyState>
            ) : (
              groups.map((g) => (
                <section key={g.group} className={styles.group} aria-label={g.label}>
                  <Text variant="small" tone="secondary">
                    {g.label}
                  </Text>
                  <ul className={styles.list}>
                    {g.items.map((item) => (
                      <li key={item.id}>
                        <Row
                          workspace={workspace}
                          item={item}
                          logo={data.catalog.find((e) => e.kind === item.kind)?.logo ?? item.kind}
                          canManage={data.canManage}
                          onRemove={() => setRemoving(item)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </section>
          <Text tone="secondary" variant="small">
            Missing a tool? Webhooks send every CirCI event as signed JSON.
          </Text>
          <AddIntegrationDialog
            workspace={workspace}
            open={adding}
            onOpenChange={setAdding}
            catalog={data.catalog}
            added={data.integrations.map((i) => i.kind)}
          />
          <ConfirmDialog
            open={removing !== null}
            onOpenChange={(open) => {
              if (!open) setRemoving(null)
            }}
            title={removing ? `Remove ${integrationLabel(removing)}?` : 'Remove integration?'}
            description={
              removing?.group === 'git'
                ? 'The teams that report to it stop showing build status on pull requests. You can connect it again later.'
                : 'Teams stop using it. You can connect it again later.'
            }
            confirmLabel="Remove"
            loading={remove.isPending}
            onConfirm={() => {
              if (!removing) return
              remove.mutate(removing, {
                onSuccess: () => announce(`${integrationLabel(removing)} removed`),
                onSettled: () => setRemoving(null),
              })
            }}
          />
        </>
      ) : null}
    </Frame>
  )
}

function Row(props: {
  workspace: string
  item: Integration.Item
  logo: string
  canManage: boolean
  onRemove: () => void
}) {
  const { item } = props
  const label = integrationLabel(item)
  return (
    <ListRow density="two-line">
      <div className={styles.row}>
        <ProviderLogo kind={props.logo} />
        <div className={styles.name}>
          <Text>{item.name}</Text>
          <Text variant="small" tone="secondary">
            {teamCountLabel(item.teamCount)}
          </Text>
        </div>
        <div className={styles.trailing}>
          {item.needsAttention ? (
            <Badge tone="state" state="rejected" shape="tag">
              Needs attention
            </Badge>
          ) : (
            <Badge shape="tag">Connected</Badge>
          )}
          <Link
            to="/workspaces/$workspace/settings/integrations/$kind/$id"
            params={{ workspace: props.workspace, kind: item.kind, id: item.id }}
            aria-label={`Configure ${label}`}
          >
            Configure
          </Link>
          {props.canManage ? (
            <Button variant="danger" onClick={props.onRemove} aria-label={`Remove ${label}`}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
    </ListRow>
  )
}
