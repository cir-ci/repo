import type { Slack } from '@circi/api'
import {
  Banner,
  Button,
  Checkbox,
  EmptyState,
  ListRow,
  SectionHeader,
  Select,
  Text,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearch } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { Frame } from '#features/settings/Frame.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'

import {
  channelItems,
  eventsSummary,
  initialEvents,
  installNote,
  SLACK_EVENT_LABEL,
  SLACK_EVENTS,
  slackChannelsQuery,
  slackPageQuery,
  useSlackInstall,
  useSlackMapping,
} from './slack-api.ts'

import styles from './Integrations.module.css'

/**
 * The Slack integration (undesigned: it follows the GitHub page's pattern). Each project sends its
 * notices to one channel of the workspace, and the events say which ones: a review requested of
 * someone, a review that ran overdue, a build rejected (with its reason), optionally an approval.
 * A project with no channel sends nothing.
 */
export function SlackIntegrationPage() {
  const { org } = useParams({ from: '/organizations/$org/settings/integrations/slack' })
  const search: { slack?: unknown } = useSearch({ strict: false })
  useDocumentTitle('Slack', 'Integrations', org)
  const { data, error, refetch } = useQuery(slackPageQuery(org))
  const install = useSlackInstall(org)
  const mapping = useSlackMapping(org)
  const note = installNote(search.slack)

  return (
    <Frame
      crumbs={[org, 'Integrations', 'Slack']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This organization doesn’t exist"
      readOnlyNote={data && !data.canManage && 'Only owners and admins can change Slack channels.'}
    >
      {data ? (
        <section className={styles.groups}>
          <SectionHeader
            title="Slack"
            description="Choose a channel for each project and which events it hears about. A project without a channel sends nothing."
          />
          {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
          {install.error ? <Banner tone="danger">{install.error.message}</Banner> : null}
          {data.workspaces.length === 0 ? (
            <EmptyState title="Slack isn’t connected">
              {!data.configured ? (
                'This server has no Slack app configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to add one.'
              ) : data.canManage ? (
                <Button
                  variant="primary"
                  loading={install.isPending}
                  onClick={() => install.mutate()}
                >
                  Connect Slack
                </Button>
              ) : (
                <>
                  Ask an owner or admin to connect it from{' '}
                  <Link to="/organizations/$org/settings/integrations" params={{ org }}>
                    Integrations
                  </Link>
                  .
                </>
              )}
            </EmptyState>
          ) : (
            <>
              {data.workspaces
                .filter((w) => w.needsAttention)
                .map((w) => (
                  <Banner
                    key={w.id}
                    tone="danger"
                    title={`CirCI can’t reach ${w.name}:`}
                    action={
                      data.canManage && data.configured ? (
                        <Button
                          loading={install.isPending}
                          onClick={() => install.mutate()}
                          aria-label={`Reinstall ${w.name}`}
                        >
                          Reinstall
                        </Button>
                      ) : undefined
                    }
                  >
                    Slack no longer accepts the app’s token. Reinstall it to send messages again.
                  </Banner>
                ))}
              {mapping.save.error ? (
                <Banner tone="danger">{mapping.save.error.message}</Banner>
              ) : null}
              {mapping.clear.error ? (
                <Banner tone="danger">{mapping.clear.error.message}</Banner>
              ) : null}
              <ul className={styles.list} aria-label="Channels by project">
                {data.projects.map((p) => (
                  <li key={p.slug}>
                    <ProjectChannel
                      key={`${p.integrationId ?? ''}:${p.channelId ?? ''}:${p.events.join(',')}`}
                      org={org}
                      project={p}
                      workspaces={data.workspaces}
                      canManage={data.canManage}
                      saving={mapping.save.isPending}
                      onSave={(input) => mapping.save.mutate({ project: p.slug, ...input })}
                      onClear={(integrationId) =>
                        mapping.clear.mutate({ project: p.slug, integrationId })
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

function ProjectChannel(props: {
  org: string
  project: Slack.ProjectMapping
  workspaces: Slack.Workspace[]
  canManage: boolean
  saving: boolean
  onSave: (input: { integrationId: string } & Slack.MappingInput) => void
  onClear: (integrationId: string) => void
}) {
  const { project, workspaces } = props
  const [workspaceId, setWorkspaceId] = useState(project.integrationId ?? workspaces[0]?.id ?? '')
  const workspace = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0]
  const [channelId, setChannelId] = useState(project.channelId ?? '')
  const [events, setEvents] = useState<Slack.Event[]>(initialEvents(project.events))
  const channels = useQuery({
    ...slackChannelsQuery(props.org, workspace?.id ?? ''),
    enabled: Boolean(workspace && props.canManage),
  })
  const items = channelItems(channels.data?.channels ?? [], {
    id: project.channelId,
    name: project.channelName,
  })

  if (!props.canManage) {
    return (
      <ListRow density="two-line">
        <div className={styles.row}>
          <div className={styles.name}>
            <Text>{project.name}</Text>
            <Text variant="small" tone="secondary">
              {project.channelId ? eventsSummary(project.events) : 'Not sending'}
            </Text>
          </div>
          <Text tone="secondary" variant="mono">
            {project.channelName ? `#${project.channelName}` : '—'}
          </Text>
        </div>
      </ListRow>
    )
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const picked = items.find((i) => i.value === channelId)
    if (!picked || !workspace) return
    props.onSave({
      integrationId: workspace.id,
      channelId,
      channelName: picked.name,
      events,
    })
  }

  return (
    <ListRow density="two-line">
      <form onSubmit={submit} noValidate className={styles.form} aria-label={project.name}>
        <div className={styles.repoRow}>
          {workspaces.length > 1 ? (
            <Select
              label={`${project.name} workspace`}
              hideLabel
              items={workspaces.map((w) => ({ value: w.id, label: w.name }))}
              value={workspace?.id ?? ''}
              onValueChange={(v) => {
                setWorkspaceId(v)
                setChannelId('')
              }}
            />
          ) : null}
          <Select
            className={styles.repoField}
            label={`${project.name} channel`}
            items={items}
            value={channelId}
            placeholder={channels.isPending ? 'Loading channels…' : 'Choose a channel'}
            onValueChange={setChannelId}
            {...(channels.error ? { error: channels.error.message } : {})}
          />
        </div>
        <div role="group" aria-label={`${project.name} events`} className={styles.form}>
          {SLACK_EVENTS.map((event) => (
            <Checkbox
              key={event}
              label={SLACK_EVENT_LABEL[event]}
              checked={events.includes(event)}
              onCheckedChange={(on) =>
                setEvents((cur) => (on ? [...cur, event] : cur.filter((x) => x !== event)))
              }
            />
          ))}
        </div>
        <div className={styles.trailing}>
          <Button type="submit" variant="primary" loading={props.saving} disabled={!channelId}>
            {project.channelId ? 'Update' : 'Save'}
          </Button>
          {project.channelId && project.integrationId ? (
            <Button
              variant="danger"
              onClick={() => {
                if (project.integrationId) props.onClear(project.integrationId)
              }}
            >
              Stop sending
            </Button>
          ) : null}
        </div>
      </form>
    </ListRow>
  )
}
