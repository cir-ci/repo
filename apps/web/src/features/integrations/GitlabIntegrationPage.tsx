import type { Integration } from '@circi/api'
import {
  Banner,
  Button,
  EmptyState,
  ListRow,
  SectionHeader,
  Select,
  Text,
  TextField,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { type FormEvent, useId, useState } from 'react'

import { Frame } from '#features/settings/Frame.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'

import { repositoriesQuery } from './api.ts'
import { gitlabPageQuery, isGitlabProjectPath, useGitlabProjectRepository } from './gitlab-api.ts'

import styles from './Integrations.module.css'

/**
 * The GitLab integration (no canvas design yet: it follows the GitHub page): which GitLab project
 * each CirCI project reports to, by its path with namespace. Builds show up on the merge request's
 * head commit as a commit status and as one summary note. A GitLab webhook (project or group, for
 * merge request and comment events) links merge requests to their authors and lets
 * `/circi approve` notes review; its address and secret token are shown here.
 */
export function GitlabIntegrationPage() {
  const { org } = useParams({ from: '/organizations/$org/settings/integrations/gitlab' })
  useDocumentTitle('GitLab', 'Integrations', org)
  const { data, error, refetch } = useQuery(gitlabPageQuery(org))
  const actions = useGitlabProjectRepository(org)

  return (
    <Frame
      crumbs={[org, 'Integrations', 'GitLab']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This organization doesn’t exist"
      readOnlyNote={data && !data.canManage && 'Only owners and admins can change projects.'}
    >
      {data ? (
        <section className={styles.groups}>
          <SectionHeader
            title="GitLab"
            description={
              <>
                Builds show up on the merge request’s commit as a commit status and as one summary
                note. To link merge requests to their authors and to approve or reject with{' '}
                <Text as="code" variant="mono">
                  /circi approve
                </Text>{' '}
                notes, add a webhook (Settings, Webhooks) for merge request and comment events at{' '}
                <Text as="code" variant="mono">
                  {data.webhookUrl}
                </Text>
                {data.webhookSecret ? (
                  <>
                    {' '}
                    with the secret token{' '}
                    <Text as="code" variant="mono">
                      {data.webhookSecret}
                    </Text>
                  </>
                ) : null}
                .
              </>
            }
          />
          {data.connections.length === 0 ? (
            <EmptyState title="GitLab isn’t connected">
              <Link to="/organizations/$org/settings/integrations" params={{ org }}>
                Add it from Integrations
              </Link>{' '}
              first.
            </EmptyState>
          ) : (
            <>
              {data.connections.some((c) => c.needsAttention) ? (
                <Banner tone="danger" title="CirCI can’t reach GitLab:">
                  an access token was revoked or has expired. Connect GitLab again with a new token
                  from Integrations.
                </Banner>
              ) : null}
              {actions.link.error ? (
                <Banner tone="danger">{actions.link.error.message}</Banner>
              ) : null}
              {actions.unlink.error ? (
                <Banner tone="danger">{actions.unlink.error.message}</Banner>
              ) : null}
              <ul className={styles.list} aria-label="GitLab projects by project">
                {data.projects.map((p) => (
                  <li key={p.slug}>
                    <ProjectMapping
                      key={`${p.repoRef ?? ''}@${p.connectionId ?? ''}`}
                      org={org}
                      project={p}
                      connections={data.connections}
                      canManage={data.canManage}
                      saving={actions.link.isPending}
                      onSave={(repoRef, connectionId) =>
                        actions.link.mutate({ project: p.slug, repoRef, connectionId })
                      }
                      onUnlink={() => actions.unlink.mutate(p.slug)}
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

function ProjectMapping(props: {
  project: Integration.GitlabPage['projects'][number]
  connections: Integration.GitlabPage['connections']
  org: string
  canManage: boolean
  saving: boolean
  onSave: (repoRef: string, connectionId: string) => void
  onUnlink: () => void
}) {
  const { project, connections } = props
  const listId = useId()
  const [repoRef, setRepoRef] = useState(project.repoRef ?? '')
  const [picked, setPicked] = useState(project.connectionId ?? connections[0]?.id ?? '')
  // A removed connection can no longer be picked; fall back to the first one.
  const connection = connections.find((c) => c.id === picked) ?? connections[0]
  const repos = useQuery({
    ...repositoriesQuery(props.org, connection?.id ?? ''),
    enabled: Boolean(connection && props.canManage),
  })
  const valid = isGitlabProjectPath(repoRef)

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (valid && connection) props.onSave(repoRef, connection.id)
  }

  if (!props.canManage) {
    return (
      <ListRow>
        <div className={styles.row}>
          <Text>{project.name}</Text>
          <Text tone="secondary" variant="mono">
            {project.repoRef ?? 'Not reporting'}
          </Text>
        </div>
      </ListRow>
    )
  }
  return (
    <ListRow density="two-line">
      <form onSubmit={submit} noValidate className={styles.repoRow} aria-label={project.name}>
        {connections.length > 1 ? (
          <Select
            label={`${project.name} GitLab account`}
            hideLabel
            items={connections.map((c) => ({ value: c.id, label: c.name }))}
            value={connection?.id ?? ''}
            onValueChange={setPicked}
          />
        ) : null}
        <TextField
          className={styles.repoField}
          name="repoRef"
          label={`${project.name} GitLab project`}
          placeholder="acme/tools/web"
          value={repoRef}
          onChange={(e) => setRepoRef(e.target.value)}
          list={listId}
          {...(repoRef && !valid
            ? { error: 'Use the project path with its namespace, e.g. acme/web' }
            : {})}
        />
        <datalist id={listId}>
          {(repos.data?.repositories ?? []).map((r) => (
            <option key={r.ref} value={r.ref} />
          ))}
        </datalist>
        <Button type="submit" variant="primary" loading={props.saving} disabled={!valid}>
          {project.repoRef ? 'Update' : 'Link'}
        </Button>
        {project.repoRef ? (
          <Button
            variant="danger"
            onClick={() => {
              setRepoRef('')
              props.onUnlink()
            }}
          >
            Unlink
          </Button>
        ) : null}
      </form>
    </ListRow>
  )
}
