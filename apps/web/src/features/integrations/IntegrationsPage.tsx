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
import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { useDocumentTitle } from '../../lib/document-title.ts'
import { Frame } from '../settings/Frame.tsx'
import { AddIntegrationDialog } from './AddIntegrationDialog.tsx'
import {
  groupItems,
  integrationPage,
  integrationsQuery,
  projectCountLabel,
  useRemoveIntegration,
} from './api.ts'
import { ProviderLogo } from './logos.tsx'

import styles from './Integrations.module.css'

/**
 * Organisation settings › Integrations: what the organisation has connected, under its group
 * headings. Projects have no integration settings of their own; each integration's page says which
 * projects use it. Owners and admins add and remove; everyone else can look.
 */
export function IntegrationsPage() {
  const { org } = useParams({ from: '/organizations/$org/settings/integrations' })
  useDocumentTitle('Integrations', org)
  const { data, error, refetch } = useQuery(integrationsQuery(org))
  const remove = useRemoveIntegration(org)
  const announce = useAnnounce()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Integration.Item | null>(null)
  const groups = data ? groupItems(data.integrations) : []

  return (
    <Frame
      crumbs={[org, 'Integrations']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This organization doesn’t exist"
      readOnlyNote={
        data && !data.canManage && 'Only owners and admins can add or remove integrations.'
      }
    >
      {data ? (
        <>
          <section className={styles['groups']}>
            <div className={styles['head']}>
              <SectionHeader
                title="Integrations"
                description={`Tools connected to ${org}. Each integration’s settings say which projects use it and how.`}
              />
              {data.canManage ? (
                <Button variant="primary" onClick={() => setAdding(true)}>
                  Add integration
                </Button>
              ) : null}
            </div>
            {remove.error ? <Banner tone="danger">{remove.error.message}</Banner> : null}
            {groups.length === 0 ? (
              <EmptyState title="No integrations yet">
                Add a git host so pull requests show their visual review status.
              </EmptyState>
            ) : (
              groups.map((g) => (
                <section key={g.group} className={styles['group']} aria-label={g.label}>
                  <Text variant="small" tone="secondary">
                    {g.label}
                  </Text>
                  <ul className={styles['list']}>
                    {g.items.map((item) => (
                      <li key={item.id}>
                        <Row
                          org={org}
                          item={item}
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
            org={org}
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
            title={removing ? `Remove ${removing.name}?` : 'Remove integration?'}
            description={
              removing?.group === 'git'
                ? 'The projects that report to it stop showing build status on pull requests. You can connect it again later.'
                : 'Projects stop using it. You can connect it again later.'
            }
            confirmLabel="Remove"
            loading={remove.isPending}
            onConfirm={() => {
              if (!removing) return
              remove.mutate(removing.id, {
                onSuccess: () => announce(`${removing.name} removed`),
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
  org: string
  item: Integration.Item
  canManage: boolean
  onRemove: () => void
}) {
  const { item } = props
  const page = integrationPage(item.kind)
  const label = `${item.kind} ${item.name}`
  return (
    <ListRow density="two-line">
      <div className={styles['row']}>
        <ProviderLogo kind={item.kind} />
        <div className={styles['name']}>
          <Text>{item.name}</Text>
          <Text variant="small" tone="secondary">
            {projectCountLabel(item.projectCount)}
          </Text>
        </div>
        <div className={styles['trailing']}>
          {item.needsAttention ? (
            <Badge tone="state" state="rejected" shape="tag">
              Needs attention
            </Badge>
          ) : (
            <Badge shape="tag">Connected</Badge>
          )}
          {page ? (
            <Link
              to="/organizations/$org/settings/integrations/github"
              params={{ org: props.org }}
              aria-label={`Configure ${label}`}
            >
              Configure
            </Link>
          ) : null}
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
