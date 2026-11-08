import { Badge, Banner, Button, Heading, SectionHeader, Text, TextField } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { Frame } from '#features/settings/Frame.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'

import {
  githubAppNote,
  githubAppQuery,
  githubSourceNote,
  useCreateGithubApp,
} from './github-app-api.ts'

import styles from './InstancePage.module.css'

/**
 * Instance settings (instance admins): the GitHub App. One click creates it on GitHub from a
 * manifest (name, address, permissions and events pre-filled) and CirCI stores what GitHub hands
 * back; nothing is hosted outside this instance. An App set in the environment is shown, not edited.
 */
export function InstancePage() {
  useDocumentTitle('Instance')
  const search: { githubApp?: unknown } = useSearch({ strict: false })
  const { data, error, refetch } = useQuery(githubAppQuery())
  const create = useCreateGithubApp()
  const [name, setName] = useState<string | null>(null)
  const [organization, setOrganization] = useState('')
  const note = githubAppNote(search.githubApp)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!data) return
    create.mutate({ name: name ?? data.defaultName, organization })
  }

  return (
    <Frame
      crumbs={['Instance', 'GitHub App']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
    >
      {data ? (
        <div className={styles.page}>
          <Heading level="title" as="h1">
            GitHub App
          </Heading>
          {note ? <Banner tone="danger">{note}</Banner> : null}
          <div className={styles.status}>
            <Badge shape="tag">
              {data.source === 'none'
                ? 'Not set up'
                : data.source === 'env'
                  ? 'Environment'
                  : 'Created here'}
            </Badge>
            <Text tone="secondary">{githubSourceNote(data)}</Text>
          </div>
          {data.source !== 'none' ? (
            <dl className={styles.facts}>
              <dt>App id</dt>
              <dd>{data.appId ?? 'Unknown'}</dd>
              <dt>App</dt>
              <dd>
                {data.htmlUrl ? <a href={data.htmlUrl}>{data.slug ?? data.htmlUrl}</a> : 'Unknown'}
              </dd>
            </dl>
          ) : null}
          {data.source === 'manifest' || data.source === 'none' ? (
            data.canManage ? (
              <form
                onSubmit={submit}
                noValidate
                className={styles.form}
                aria-label="Create GitHub App"
              >
                <SectionHeader
                  title={
                    data.source === 'none' ? 'Create the GitHub App' : 'Create another GitHub App'
                  }
                />
                <Text tone="secondary" variant="small">
                  GitHub shows you the App with everything filled in; you confirm it there, then
                  install it on your account or organization. Checks and pull request comments are
                  all it asks for.
                </Text>
                {data.blocked ? <Banner tone="danger">{data.blocked}</Banner> : null}
                {data.warning ? <Banner tone="warning">{data.warning}</Banner> : null}
                <TextField
                  label="App name"
                  description="GitHub App names are unique across GitHub."
                  value={name ?? data.defaultName}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={34}
                />
                <TextField
                  label="GitHub organization (leave empty for your account)"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  autoComplete="off"
                />
                {create.error ? <Banner tone="danger">{create.error.message}</Banner> : null}
                <div>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={create.isPending}
                    disabled={Boolean(data.blocked)}
                  >
                    Create GitHub App
                  </Button>
                </div>
              </form>
            ) : (
              <Banner>Only instance admins can create the GitHub App.</Banner>
            )
          ) : null}
        </div>
      ) : null}
    </Frame>
  )
}
