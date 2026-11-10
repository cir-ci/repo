import type { Integration } from '@circi/api'
import { Banner, Button, EmptyState, Heading, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams, useSearch } from '@tanstack/react-router'
import { useState } from 'react'

import { MembersRedirect } from '#features/workspace-settings/MembersRedirect.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { useClientLink } from '#lib/use-client-link.ts'

import { AddIntegrationDialog } from './AddIntegrationDialog.tsx'
import { connectNote } from './api/generic.ts'
import { groupItems, integrationLabel, integrationsQuery, teamCountLabel } from './api/index.ts'
import { IntegrationFrame } from './IntegrationFrame.tsx'
import { ProviderLogo } from './logos.tsx'

import styles from './Integrations.module.css'

/**
 * Workspace settings › Integrations: what the workspace has connected, under its group
 * headings, each with Configure. Adding is the dialog; removing and reconnecting are on the
 * integration's own page. Teams have no integration settings of their own; each integration's
 * page says which teams use it. Owners and admins add; everyone else can look.
 */
export function IntegrationsPage() {
  const { workspace } = useParams({ from: '/workspaces/$workspace/settings/integrations' })
  useDocumentTitle('Integrations', workspace)
  const search: { connect?: unknown; kind?: unknown } = useSearch({ strict: false })
  const { data, error, refetch } = useQuery(integrationsQuery(workspace))
  const [adding, setAdding] = useState(false)
  const groups = data ? groupItems(data.integrations) : []
  // An OAuth install that did not finish lands here (a finished one lands on the new page).
  const failedKind = typeof search.kind === 'string' ? search.kind : ''
  const note = connectNote(
    search.connect,
    data?.catalog.find((e) => e.kind === failedKind)?.name ?? failedKind,
  )

  return (
    <IntegrationFrame
      workspace={workspace}
      title="Integrations"
      headingInPage={Boolean(data) && !error}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This workspace doesn't exist"
      forbidden={data && !data.canManage ? <MembersRedirect workspace={workspace} /> : null}
    >
      {data ? (
        <>
          <div className={styles.sectionHead}>
            <div>
              <Heading level="title" as="h1">
                Integrations
              </Heading>
            </div>
            {data.canManage ? (
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add integration
              </Button>
            ) : null}
          </div>
          {note && search.connect !== 'connected' ? (
            <Banner tone={note.tone}>{note.text}</Banner>
          ) : null}
          {groups.length === 0 ? (
            <EmptyState
              title="No integrations yet"
              {...(data.canManage
                ? {
                    action: (
                      <Button variant="primary" onClick={() => setAdding(true)}>
                        Add integration
                      </Button>
                    ),
                  }
                : {})}
            >
              Add a git host so pull requests show their visual review status.
            </EmptyState>
          ) : (
            <div className={styles.groups}>
              {groups.map((g) => (
                <section key={g.group} className={styles.group} aria-label={g.label}>
                  <Heading level="heading" as="h2">
                    <Text variant="small" tone="secondary">
                      {g.label}
                    </Text>
                  </Heading>
                  <ul className={styles.box}>
                    {g.items.map((item) => (
                      <li key={item.id}>
                        <Row
                          workspace={workspace}
                          item={item}
                          logo={data.catalog.find((e) => e.kind === item.kind)?.logo ?? item.kind}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
          <Text tone="tertiary" variant="small">
            Missing a tool? Webhooks send every CirCI event as signed JSON.
          </Text>
          <AddIntegrationDialog
            workspace={workspace}
            open={adding}
            onOpenChange={setAdding}
            catalog={data.catalog}
            added={data.integrations.map((i) => i.kind)}
          />
        </>
      ) : null}
    </IntegrationFrame>
  )
}

function Row(props: { workspace: string; item: Integration.Item; logo: string }) {
  const { item } = props
  const clientLink = useClientLink()
  return (
    <div className={styles.row}>
      <ProviderLogo kind={props.logo} />
      <span className={styles.name}>
        <Text>{item.kindName}</Text>
        <Text variant="small" tone="tertiary">
          {item.name} · {teamCountLabel(item.teamCount)}
        </Text>
      </span>
      <span
        className={`${styles.status} ${item.needsAttention ? styles.statusBad : styles.statusOk}`}
      >
        <span className={styles.dot} aria-hidden="true" />
        {item.needsAttention ? 'Needs attention' : 'Connected'}
      </span>
      <Button
        aria-label={`Configure ${integrationLabel(item)}`}
        {...clientLink({
          to: '/workspaces/$workspace/settings/integrations/$kind/$id',
          params: { workspace: props.workspace, kind: item.kind, id: item.id },
        })}
      >
        Configure
      </Button>
    </div>
  )
}
