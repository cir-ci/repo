import type { Issue } from '@circi/api'
import { Banner, Button, EmptyState, ListRow, SectionHeader, Select, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { Frame } from '#features/settings/Frame.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'

import {
  TARGET_NOUN,
  TRACKER_NAME,
  type TrackerKind,
  targetsQuery,
  trackerPageQuery,
  useTrackerMapping,
} from './trackers-api.ts'

import styles from './Integrations.module.css'

export function LinearIntegrationPage() {
  const { org } = useParams({ from: '/organizations/$org/settings/integrations/linear' })
  return <TrackerIntegrationPage kind="linear" org={org} />
}

export function JiraIntegrationPage() {
  const { org } = useParams({ from: '/organizations/$org/settings/integrations/jira' })
  return <TrackerIntegrationPage kind="jira" org={org} />
}

/**
 * A tracker's integration page (Linear or Jira; undesigned, the GitHub page's pattern): which
 * team or project each CirCI project files its issues in. A project with none has no "Create
 * issue" action on its builds.
 */
export function TrackerIntegrationPage({ kind, org }: TrackerIntegrationPage.Props) {
  const name = TRACKER_NAME[kind]
  useDocumentTitle(name, 'Integrations', org)
  const { data, error, refetch } = useQuery(trackerPageQuery(org, kind))
  const mapping = useTrackerMapping(org)

  return (
    <Frame
      crumbs={[org, 'Integrations', name]}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This organization doesn’t exist"
      readOnlyNote={data && !data.canManage && `Only owners and admins can change where issues go.`}
    >
      {data ? (
        <section className={styles.groups}>
          <SectionHeader
            title={name}
            description={`Reviewers can create a ${name} issue from a rejected snapshot, with a link to the diff. Choose the ${TARGET_NOUN[kind]} each project’s issues go to.`}
          />
          {data.connections.length === 0 ? (
            <EmptyState title={`${name} isn’t connected`}>
              <Link to="/organizations/$org/settings/integrations" params={{ org }}>
                Add it from Integrations
              </Link>{' '}
              first.
            </EmptyState>
          ) : (
            <>
              {data.connections.some((c) => c.needsAttention) ? (
                <Banner tone="danger" title={`CirCI can’t use ${name}:`}>
                  the saved credentials were rejected. Remove the connection and add it again with
                  new credentials.
                </Banner>
              ) : null}
              {mapping.set.error ? (
                <Banner tone="danger">{mapping.set.error.message}</Banner>
              ) : null}
              {mapping.clear.error ? (
                <Banner tone="danger">{mapping.clear.error.message}</Banner>
              ) : null}
              <ul className={styles.list} aria-label={`${name} ${TARGET_NOUN[kind]} by project`}>
                {data.projects.map((p) => (
                  <li key={p.slug}>
                    <ProjectTarget
                      key={`${p.integrationId ?? ''}@${p.target ?? ''}`}
                      kind={kind}
                      org={org}
                      project={p}
                      connections={data.connections}
                      canManage={data.canManage}
                      saving={mapping.set.isPending}
                      onSave={(connectionId, target) =>
                        mapping.set.mutate({ connectionId, project: p.slug, target })
                      }
                      onClear={(connectionId) =>
                        mapping.clear.mutate({ connectionId, project: p.slug })
                      }
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}
    </Frame>
  )
}

export namespace TrackerIntegrationPage {
  export interface Props {
    kind: TrackerKind
    org: string
  }
}

function ProjectTarget(props: {
  kind: TrackerKind
  org: string
  project: Issue.Page['projects'][number]
  connections: Issue.Page['connections']
  canManage: boolean
  saving: boolean
  onSave: (connectionId: string, target: string) => void
  onClear: (connectionId: string) => void
}) {
  const { project, connections, kind } = props
  const noun = TARGET_NOUN[kind]
  const [picked, setPicked] = useState(project.integrationId ?? connections[0]?.id ?? '')
  const connection = connections.find((c) => c.id === picked) ?? connections[0]
  const [target, setTarget] = useState(project.target ?? '')
  const targets = useQuery({
    ...targetsQuery(props.org, connection?.id ?? ''),
    enabled: Boolean(connection && props.canManage),
  })

  if (!props.canManage) {
    return (
      <ListRow>
        <div className={styles.row}>
          <Text>{project.name}</Text>
          <Text tone="secondary">{project.targetName ?? 'No issues'}</Text>
        </div>
      </ListRow>
    )
  }
  const items = (targets.data?.targets ?? []).map((t) => ({ value: t.ref, label: t.name }))
  return (
    <ListRow density="two-line">
      <div className={styles.repoRow} role="group" aria-label={project.name}>
        {connections.length > 1 ? (
          <Select
            label={`${project.name} account`}
            hideLabel
            items={connections.map((c) => ({ value: c.id, label: c.name }))}
            value={connection?.id ?? ''}
            onValueChange={(v) => {
              setPicked(v)
              setTarget('')
            }}
          />
        ) : null}
        <Select
          className={styles.repoField}
          label={`${project.name} ${noun}`}
          items={items}
          value={target}
          placeholder={targets.isPending ? `Loading ${noun}s…` : `Choose a ${noun}`}
          onValueChange={setTarget}
        />
        <Button
          variant="primary"
          loading={props.saving}
          disabled={!connection || !target}
          onClick={() => connection && props.onSave(connection.id, target)}
        >
          {project.target ? 'Update' : 'Link'}
        </Button>
        {project.target && project.integrationId ? (
          <Button
            variant="danger"
            onClick={() => {
              setTarget('')
              if (project.integrationId) props.onClear(project.integrationId)
            }}
          >
            Unlink
          </Button>
        ) : null}
      </div>
      {targets.error ? (
        <Text variant="small" tone="rejected" role="alert">
          {targets.error.message}
        </Text>
      ) : null}
    </ListRow>
  )
}
