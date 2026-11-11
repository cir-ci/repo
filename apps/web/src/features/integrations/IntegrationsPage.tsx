import type { Integration } from '@circi/api'
import {
  Avatar,
  Banner,
  Button,
  EmptyState,
  Heading,
  Menu,
  PlugIcon,
  PlusIcon,
  Text,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useState } from 'react'

import { useSidebarModel } from '#features/sidebar/api.ts'
import { MembersRedirect } from '#features/workspace-settings/MembersRedirect.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { useClientLink } from '#lib/use-client-link.ts'

import { AddIntegrationDialog } from './AddIntegrationDialog.tsx'
import { connectNote } from './api/generic.ts'
import { groupItems, integrationLabel, integrationsQuery, projectCountLabel } from './api/index.ts'
import { IntegrationFrame } from './IntegrationFrame.tsx'
import { ProviderLogo } from './logos.tsx'

import styles from './Integrations.module.css'

/**
 * Workspace settings › Integrations: what the workspace has connected, under its group
 * headings, each with Configure. Adding is the dialog; removing and reconnecting are on the
 * integration's own page. Projects have no integration settings of their own; each integration's
 * page says which projects use it. Owners and admins add; everyone else can look.
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
      actions={
        data?.canManage ? (
          <Button
            variant="primary"
            leading={<PlusIcon size={14} />}
            onClick={() => setAdding(true)}
          >
            Add integration
          </Button>
        ) : undefined
      }
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This workspace doesn't exist"
      forbidden={data && !data.canManage ? <MembersRedirect workspace={workspace} /> : null}
    >
      {data ? (
        <>
          {note && search.connect !== 'connected' ? (
            <Banner tone={note.tone}>{note.text}</Banner>
          ) : null}
          {groups.length === 0 ? (
            <EmptyState size="page" icon={<PlugIcon />} title="No integrations yet">
              {data.canManage
                ? 'Add a git host so pull requests show their visual review status.'
                : 'Ask an owner or admin to add a git host.'}
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
            Missing a tool? <WebhooksLink workspace={workspace} /> send every CirCI event as signed
            JSON.
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
          {item.name} · {projectCountLabel(item.projectCount)}
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

/**
 * "Webhooks" in the note under the integrations: a project's own setting, so with one project it opens
 * that project's Webhooks page, and with several a menu of the projects, each opening its Webhooks page.
 * Both stay inside settings.
 */
function WebhooksLink({ workspace }: { workspace: string }) {
  const navigate = useNavigate()
  const clientLink = useClientLink()
  const { data: model } = useSidebarModel(workspace)
  const projects = model?.projects ?? []
  const webhooksOf = (project: string) => ({
    to: '/$workspace/$project/settings/webhooks' as const,
    params: { workspace, project },
  })
  const [only] = projects
  if (projects.length === 1 && only) {
    const link = clientLink(webhooksOf(only.slug))
    return (
      <a href={link.href} onClick={link.onClick} className={styles.noteLink}>
        Webhooks
      </a>
    )
  }
  if (projects.length === 0) return <>Webhooks</>
  return (
    <Menu
      size="md"
      trigger={
        <Button variant="link" className={styles.noteLink}>
          Webhooks
        </Button>
      }
      items={projects.map((t) => ({
        label: t.name,
        icon: (
          <Avatar
            type="project"
            aria-hidden
            slug={t.slug}
            name={t.name}
            color={t.color}
            icon={t.icon}
            size={18}
          />
        ),
        onSelect: () => void navigate(webhooksOf(t.slug)),
      }))}
    />
  )
}
