import type { Integration } from '@circi/api'
import { Banner, Button, EmptyState, ListRow, SectionHeader, Text, TextField } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { type FormEvent, useId } from 'react'

import { useDocumentTitle } from '../../lib/document-title.ts'
import { Frame } from '../settings/Frame.tsx'
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
  const first = data?.connections[0]
  const repos = useQuery({
    ...repositoriesQuery(org, first?.id ?? ''),
    enabled: Boolean(first && data?.canManage),
  })
  const actions = useProjectRepository(org)
  const listId = useId()

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
        <section className={styles['groups']}>
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
              <datalist id={listId}>
                {(repos.data?.repositories ?? []).map((r) => (
                  <option key={r.ref} value={r.ref} />
                ))}
              </datalist>
              <ul className={styles['list']} aria-label="Repositories by project">
                {data.projects.map((p) => (
                  <li key={p.slug}>
                    <ProjectRepository
                      project={p}
                      connections={data.connections}
                      canManage={data.canManage}
                      listId={listId}
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
  canManage: boolean
  listId: string
  saving: boolean
  onSave: (repoRef: string, installationId: string) => void
  onUnlink: () => void
}) {
  const { project } = props
  const installationId = project.installationId ?? props.connections[0]?.installationId ?? ''

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const value = new FormData(e.currentTarget).get('repoRef')
    if (typeof value === 'string' && value.trim()) props.onSave(value, installationId)
  }

  if (!props.canManage) {
    return (
      <ListRow>
        <div className={styles['row']}>
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
      <form onSubmit={submit} noValidate className={styles['repoRow']} aria-label={project.name}>
        <TextField
          className={styles['repoField']}
          name="repoRef"
          label={`${project.name} repository`}
          placeholder="acme/web"
          defaultValue={project.repoRef ?? ''}
          list={props.listId}
        />
        <Button type="submit" variant="primary" loading={props.saving}>
          {project.repoRef ? 'Update' : 'Link'}
        </Button>
        {project.repoRef ? (
          <Button variant="danger" onClick={props.onUnlink}>
            Unlink
          </Button>
        ) : null}
      </form>
    </ListRow>
  )
}
