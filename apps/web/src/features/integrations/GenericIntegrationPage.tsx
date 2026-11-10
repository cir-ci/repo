import type { Integration } from '@circi/api'
import {
  Banner,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Heading,
  Text,
  useAnnounce,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useState } from 'react'

import { MembersRedirect } from '#features/workspace-settings/MembersRedirect.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'

import {
  connectionLine,
  connectNote,
  mappingPageQuery,
  useInstall,
  useMapping,
} from './api/generic.ts'
import { useRemoveIntegration } from './api/index.ts'
import { ConnectForm } from './ConnectForm.tsx'
import { IntegrationFrame } from './IntegrationFrame.tsx'
import { IntegrationHead } from './IntegrationHead.tsx'
import { RepositoryRows } from './RepositoryRows.tsx'
import { TeamLinks } from './TeamLinks.tsx'
import { useTeamMark } from './TeamMark.tsx'
import { TeamRow } from './TeamRows.tsx'
import { TrackerPreview } from './TrackerPreview.tsx'

import styles from './Integrations.module.css'

/**
 * The one page for every integration, laid out as the canvas's boards: the provider's mark and
 * connection state with Reconnect and Remove, then, from the definition's mapping spec, either
 * the host's repositories each with its team (a git host) or one row per
 * team with a picker and its settings (a chat channel, a tracker team or project, a design file);
 * a few lines of what CirCI posts or sends close the page. Nothing here knows an integration:
 * it renders the definition from the API. A team without a target uses nothing.
 */
export function GenericIntegrationPage() {
  const { workspace, id } = useParams({
    from: '/workspaces/$workspace/settings/integrations/$kind/$id',
  })
  const search: { connect?: unknown } = useSearch({ strict: false })
  const { data, error, refetch } = useQuery(mappingPageQuery(workspace, id))
  const name = data?.definition.name ?? 'Integration'
  useDocumentTitle(name, 'Integrations', workspace)
  const mapping = useMapping(workspace, id)
  const install = useInstall(workspace)
  const remove = useRemoveIntegration(workspace)
  const navigate = useNavigate()
  const announce = useAnnounce()
  const mark = useTeamMark(workspace)
  const [removing, setRemoving] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const note = connectNote(search.connect, name)
  const spec = data?.definition.mapping ?? null
  const links = data?.definition.links ?? null

  // Moves a repository to another team: the old team lets go of it first.
  async function assign(input: { ref: string; from: string | null; to: string | null }) {
    try {
      if (input.from) await mapping.clear.mutateAsync(input.from)
      if (input.to) await mapping.save.mutateAsync({ team: input.to, ref: input.ref })
    } catch {
      // Shown by the banners below, from the mutations' own errors.
    }
  }

  const reinstall = (label: string) =>
    data?.canManage && data.configured && data.definition.oauth ? (
      <Button
        loading={install.isPending}
        onClick={() => install.mutate(data.integration.kind)}
        aria-label={`${label} ${data.integration.name}`}
      >
        {label}
      </Button>
    ) : null

  return (
    <IntegrationFrame
      workspace={workspace}
      below
      title={name}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This integration doesn't exist"
      forbidden={data && !data.canManage ? <MembersRedirect workspace={workspace} /> : null}
    >
      {data ? (
        <>
          <IntegrationHead
            logo={data.definition.logo}
            name={data.definition.name}
            line={connectionLine(data.definition.name, data.integration.name, data.teams)}
            needsAttention={data.integration.needsAttention}
            actions={
              data.canManage ? (
                <>
                  {data.definition.oauth && data.configured ? (
                    <Button
                      loading={install.isPending}
                      onClick={() => install.mutate(data.integration.kind)}
                      aria-label={`Reconnect ${data.integration.name}`}
                    >
                      Reconnect
                    </Button>
                  ) : data.definition.credentials.length > 0 ? (
                    <Button
                      onClick={() => setReconnecting(true)}
                      aria-label={`Reconnect ${data.integration.name}`}
                    >
                      Reconnect
                    </Button>
                  ) : null}
                  <Button
                    variant="danger"
                    onClick={() => setRemoving(true)}
                    aria-label={`Remove ${data.integration.name}`}
                  >
                    Remove
                  </Button>
                </>
              ) : null
            }
          />
          {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
          {data.integration.needsAttention ? (
            <Banner tone="danger" title={`CirCI can't reach ${data.integration.name}:`}>
              {data.integration.attentionReason ??
                `${data.definition.name} no longer accepts the saved credentials.`}
            </Banner>
          ) : null}
          {install.error ? <Banner tone="danger">{install.error.message}</Banner> : null}
          {remove.error ? <Banner tone="danger">{remove.error.message}</Banner> : null}
          {mapping.save.error ? <Banner tone="danger">{mapping.save.error.message}</Banner> : null}
          {mapping.clear.error ? (
            <Banner tone="danger">{mapping.clear.error.message}</Banner>
          ) : null}

          {spec === null ? (
            <EmptyState title="Nothing to set up">
              {data.definition.name} has no per-team settings.
            </EmptyState>
          ) : (
            <section className={styles.section} aria-labelledby="mapping-title">
              <div>
                <Heading level="title" as="h2" id="mapping-title">
                  {data.definition.group === 'git' ? 'Repositories' : 'Teams'}
                </Heading>
                <Text as="p" variant="small" tone="secondary">
                  {spec.description ?? data.definition.description}
                </Text>
              </div>
              {data.definition.group === 'git' ? (
                <RepositoryRows
                  workspace={workspace}
                  integrationId={id}
                  spec={spec}
                  teams={data.teams}
                  canManage={data.canManage}
                  onAssign={(input) => void assign(input)}
                  reinstall={reinstall('Reinstall')}
                />
              ) : (
                <ul className={styles.box} aria-label={`${spec.targetLabel} by team`}>
                  {data.teams.map((team) => (
                    <li key={team.slug}>
                      <TeamRow
                        // Start over when the saved mapping changes (after saving, or removing it).
                        key={`${team.mapping?.ref ?? ''}:${JSON.stringify(team.mapping?.extra ?? {})}`}
                        workspace={workspace}
                        integrationId={id}
                        spec={spec}
                        team={team}
                        mark={mark(team.slug, team.name)}
                        canManage={data.canManage}
                        saving={mapping.save.isPending}
                        onSave={(input) => mapping.save.mutate({ team: team.slug, ...input })}
                        onClear={() => mapping.clear.mutate(team.slug)}
                      />
                      {links && (team.mapping || data.canManage) ? (
                        <TeamLinks
                          workspace={workspace}
                          integrationId={id}
                          spec={links}
                          team={team}
                          canManage={data.canManage}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <Footer
            group={data.definition.group}
            webhook={data.webhook}
            name={data.definition.name}
          />

          <ConfirmDialog
            open={removing}
            onOpenChange={setRemoving}
            title={`Remove ${data.integration.name}?`}
            description={
              data.definition.group === 'git'
                ? 'The teams that report to it stop showing build status on pull requests. You can connect it again later.'
                : 'Teams stop using it. You can connect it again later.'
            }
            confirmLabel="Remove"
            loading={remove.isPending}
            onConfirm={() =>
              remove.mutate(
                { id: data.integration.id },
                {
                  onSuccess: () => {
                    announce(`${data.integration.name} removed`)
                    void navigate({
                      to: '/workspaces/$workspace/settings/integrations',
                      params: { workspace },
                    })
                  },
                  onSettled: () => setRemoving(false),
                },
              )
            }
          />
          <Dialog
            open={reconnecting}
            onOpenChange={setReconnecting}
            title={`Reconnect ${data.definition.name}`}
            description="Enter the credentials again; the teams' settings stay as they are."
            actions={<Button onClick={() => setReconnecting(false)}>Cancel</Button>}
          >
            <ConnectForm
              entry={data.definition}
              workspace={workspace}
              onDone={() => setReconnecting(false)}
            />
          </Dialog>
        </>
      ) : null}
    </IntegrationFrame>
  )
}

/** What CirCI posts or sends, and the webhook a git host calls: the lines that close the page. */
function Footer(props: {
  group: Integration.Group
  name: string
  webhook: Integration.MappingPage['webhook']
}) {
  const { webhook } = props
  return (
    <>
      {props.group === 'git' ? (
        <section className={styles.section} aria-labelledby="posts-title">
          <div>
            <Heading level="title" as="h2" id="posts-title">
              What CirCI posts on pull requests
            </Heading>
            <Text as="p" variant="small" tone="secondary">
              Make the check required in branch protection to block merging until changes are
              reviewed. Approving here or on {props.name} turns it green without a CI re-run.
            </Text>
          </div>
          <div className={styles.box}>
            <div className={styles.row}>
              <span className={styles.name}>
                <Text>Status check</Text>
                <Text variant="small" tone="tertiary">
                  One per build name, such as <Text variant="mono">CirCI / default</Text>, with the
                  build's changes and a review link.
                </Text>
              </span>
              <Text variant="small" tone="secondary">
                Always on
              </Text>
            </div>
            <div className={styles.row}>
              <span className={styles.name}>
                <Text>Summary comment</Text>
                <Text variant="small" tone="tertiary">
                  One per pull request, edited in place on every push.
                </Text>
              </span>
              <Text variant="small" tone="secondary">
                Always on
              </Text>
            </div>
          </div>
          <div className={styles.box}>
            {[
              ['/circi approve', 'Approves the newest build on the pull request.'],
              ['/circi reject', 'Rejects it; text after the command becomes the reason.'],
              [
                '/circi rerun',
                'Processes the build again, for example after changing the threshold.',
              ],
            ].map(([command, text]) => (
              <div key={command} className={styles.cmd}>
                <Text as="code" variant="mono">
                  {command}
                </Text>
                <Text variant="small" tone="secondary">
                  {text}
                </Text>
              </div>
            ))}
          </div>
          <Text as="p" variant="small" tone="secondary">
            Commands work for members of the workspace who linked their {props.name} account on
            their profile. Anyone else gets a reply explaining how to link.
          </Text>
          {webhook ? (
            <Text variant="small" tone="secondary">
              {props.name} calls{' '}
              <Text as="code" variant="mono">
                {webhook.url}
              </Text>
              {webhook.secret ? (
                <>
                  {' '}
                  with the secret{' '}
                  <Text as="code" variant="mono">
                    {webhook.secret}
                  </Text>
                </>
              ) : null}
              .
            </Text>
          ) : null}
        </section>
      ) : null}
      {props.group === 'tracker' ? <TrackerPreview name={props.name} /> : null}
    </>
  )
}
