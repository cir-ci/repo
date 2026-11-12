import { Badge, Banner, Button, SettingsSection, Text, TextField } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'

import { ErrorState } from '#lib/ErrorState.tsx'

import {
  githubAppNote,
  githubAppQuery,
  githubSourceNote,
  useCreateGithubApp,
} from './api/github-app.ts'

import styles from './Admin.module.css'

/**
 * The GitHub App, a section of Instance settings. One click creates it on GitHub from a manifest
 * (name, address, permissions and events pre-filled) and CirCI stores what GitHub hands back;
 * nothing is hosted outside this instance. An App set in the environment is shown, not edited.
 * `result` is the page's `?githubApp=` value, GitHub's return.
 */
export function GithubAppSection({ result }: GithubAppSection.Props) {
  const { data, error, refetch } = useQuery(githubAppQuery())
  const create = useCreateGithubApp()
  const [name, setName] = useState<string | null>(null)
  const [organization, setOrganization] = useState('')
  const note = githubAppNote(result)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!data) return
    create.mutate({ name: name ?? data.defaultName, organization })
  }

  return (
    <SettingsSection title="GitHub App" bare>
      {note ? <Banner tone="danger">{note}</Banner> : null}
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data ? (
        <Text tone="secondary">Loading…</Text>
      ) : (
        <>
          <div className={styles.toolbar}>
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
              <dt>App ID</dt>
              <dd>{data.appId ?? 'Unknown'}</dd>
              <dt>App</dt>
              <dd>
                {data.htmlUrl ? (
                  <a href={data.htmlUrl} target="_blank" rel="noopener">
                    {data.slug ?? data.htmlUrl}
                  </a>
                ) : (
                  'Unknown'
                )}
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
                  <Button type="submit" loading={create.isPending} disabled={Boolean(data.blocked)}>
                    Create GitHub App
                  </Button>
                </div>
              </form>
            ) : null
          ) : null}
        </>
      )}
    </SettingsSection>
  )
}

export namespace GithubAppSection {
  export interface Props {
    result?: unknown
  }
}
