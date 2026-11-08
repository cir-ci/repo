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

import { bitbucketPageQuery, repositoriesQuery, useBitbucketProjectRepository } from './api.ts'

import styles from './Integrations.module.css'

/**
 * The Bitbucket integration (no canvas design yet: it follows the GitHub page): which repository
 * each project reports to. Builds show up on the commit as a build status and on the pull request
 * as one summary comment. Bitbucket has no app to install, so the webhook is created by hand on
 * each repository, with the address and secret shown here.
 */
export function BitbucketIntegrationPage() {
  const { org } = useParams({ from: '/organizations/$org/settings/integrations/bitbucket' })
  useDocumentTitle('Bitbucket', 'Integrations', org)
  const { data, error, refetch } = useQuery(bitbucketPageQuery(org))
  const actions = useBitbucketProjectRepository(org)

  return (
    <Frame
      crumbs={[org, 'Integrations', 'Bitbucket']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This organization doesn’t exist"
      readOnlyNote={data && !data.canManage && 'Only owners and admins can change repositories.'}
    >
      {data ? (
        <section className={styles.groups}>
          <SectionHeader
            title="Bitbucket"
            description={
              <>
                Builds show up on the commit as a build status and on the pull request as one
                summary comment. To link pull requests to builds and to approve or reject with{' '}
                <Text as="code" variant="mono">
                  /circi approve
                </Text>{' '}
                comments, add a webhook to each repository (Repository settings, Webhooks) for pull
                request created, updated and comment created, at{' '}
                <Text as="code" variant="mono">
                  {data.webhookUrl}
                </Text>
                {data.webhookSecret ? (
                  <>
                    {' '}
                    with the secret{' '}
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
            <EmptyState title="Bitbucket isn’t connected">
              <Link to="/organizations/$org/settings/integrations" params={{ org }}>
                Add it from Integrations
              </Link>{' '}
              first.
            </EmptyState>
          ) : (
            <>
              {data.connections.some((c) => c.needsAttention) ? (
                <Banner tone="danger" title="CirCI can’t reach Bitbucket:">
                  its access token was revoked or has expired. Connect the workspace again with a
                  new token from Integrations.
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

function ProjectRepository(props: {
  project: Integration.BitbucketPage['projects'][number]
  connections: Integration.BitbucketPage['connections']
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

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (repoRef.trim() && connection) props.onSave(repoRef, connection.id)
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
            label={`${project.name} workspace`}
            hideLabel
            items={connections.map((c) => ({ value: c.id, label: c.workspace }))}
            value={connection?.id ?? ''}
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
