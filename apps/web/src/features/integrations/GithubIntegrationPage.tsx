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

import { githubPageQuery, repositoriesQuery, useProjectRepository } from './api.ts'

import styles from './Integrations.module.css'

/**
 * The GitHub integration: which repository each project reports to. Builds show up on the pull
 * request as a check with Approve and Reject buttons and as one summary comment. A project links
 * to one repository, through one of the organisation's installations.
 */
export function GithubIntegrationPage() {
  const { org } = useParams({ from: '/organizations/$org/settings/integrations/github' })
  useDocumentTitle('GitHub', 'Integrations', org)
  const { data, error, refetch } = useQuery(githubPageQuery(org))
  const actions = useProjectRepository(org)

  return (
    <Frame
      crumbs={[org, 'Integrations', 'GitHub']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This organization doesn’t exist"
      readOnlyNote={data && !data.canManage && 'Only owners and admins can change repositories.'}
    >
      {data ? (
        <section className={styles.groups}>
          <SectionHeader
            title="GitHub"
            description={
              <>
                Builds show up on the pull request as a check with Approve and Reject buttons, and
                as one summary comment. The GitHub App’s webhook address is{' '}
                <Text as="code" variant="mono">
                  {data.webhookUrl}
                </Text>
                .
              </>
            }
          />
          {data.connections.length === 0 ? (
            <EmptyState title="GitHub isn’t connected">
              <Link to="/organizations/$org/settings/integrations" params={{ org }}>
                Add it from Integrations
              </Link>{' '}
              first.
            </EmptyState>
          ) : (
            <>
              {data.connections.some((c) => c.needsAttention) ? (
                <Banner tone="danger" title="CirCI can’t reach GitHub:">
                  the GitHub App was removed or suspended. Reinstall or unsuspend it on GitHub, then
                  save a repository below again.
                </Banner>
              ) : null}
              {actions.link.error ? (
                <Banner tone="danger">{actions.link.error.message}</Banner>
              ) : null}
              {actions.unlink.error ? (
                <Banner tone="danger">{actions.unlink.error.message}</Banner>
              ) : null}
              <ul className={styles.list} aria-label="Repositories by project">
                {data.projects.map((p) => (
                  <li key={p.slug}>
                    <ProjectRepository
                      key={`${p.repoRef ?? ''}@${p.installationId ?? ''}`}
                      org={org}
                      project={p}
                      connections={data.connections}
                      canManage={data.canManage}
                      saving={actions.link.isPending}
                      onSave={(repoRef, installationId) =>
                        actions.link.mutate({ project: p.slug, repoRef, installationId })
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

function ProjectRepository(props: {
  project: Integration.GithubPage['projects'][number]
  connections: Integration.GithubPage['connections']
  org: string
  canManage: boolean
  saving: boolean
  onSave: (repoRef: string, installationId: string) => void
  onUnlink: () => void
}) {
  const { project, connections } = props
  const listId = useId()
  const [repoRef, setRepoRef] = useState(project.repoRef ?? '')
  const [picked, setPicked] = useState(
    project.installationId ?? connections[0]?.installationId ?? '',
  )
  // A removed installation can no longer be picked; fall back to the first one.
  const connection = connections.find((c) => c.installationId === picked) ?? connections[0]
  const repos = useQuery({
    ...repositoriesQuery(props.org, connection?.id ?? ''),
    enabled: Boolean(connection && props.canManage),
  })

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (repoRef.trim() && connection) props.onSave(repoRef, connection.installationId)
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
            label={`${project.name} installation`}
            hideLabel
            items={connections.map((c) => ({
              value: c.installationId,
              label: `Installation ${c.installationId}`,
            }))}
            value={connection?.installationId ?? ''}
            onValueChange={setPicked}
          />
        ) : null}
        <TextField
          className={styles.repoField}
          name="repoRef"
          label={`${project.name} repository`}
          placeholder="acme/web"
          value={repoRef}
          onChange={(e) => setRepoRef(e.target.value)}
          list={listId}
        />
        <datalist id={listId}>
          {(repos.data?.repositories ?? []).map((r) => (
            <option key={r.ref} value={r.ref} />
          ))}
        </datalist>
        <Button type="submit" variant="primary" loading={props.saving}>
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
