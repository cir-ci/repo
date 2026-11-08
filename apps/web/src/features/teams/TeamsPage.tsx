import {
  Banner,
  Button,
  Delayed,
  EmptyState,
  FolderOpenIcon,
  ListRow,
  ListSkeleton,
  PanelHeader,
  StatusIcon,
  Text,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { buildState } from '#features/builds/build-state.ts'
import { BuildMeta } from '#features/builds/BuildMeta.tsx'
import { CountsSummary } from '#features/builds/CountsSummary.tsx'
import { shotReview } from '#features/builds/diff-status.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { useClientLink } from '#lib/use-client-link.ts'

import { capabilitiesQuery, teamsQuery } from './api.ts'
import { NewWorkspaceDialog, NewTeamDialog } from './CreateDialogs.tsx'
import { useLoadingAnnouncement } from './loading.ts'
import { TeamBreadcrumbs } from './TeamBreadcrumbs.tsx'

import styles from './TeamsPage.module.css'

export function TeamsPage() {
  useDocumentTitle('Teams')
  const clientLink = useClientLink()
  const { data, error, refetch } = useQuery(teamsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const [dialog, setDialog] = useState<'team' | 'workspace' | null>(null)
  useLoadingAnnouncement(!data && !error, 'Loading teams')
  const canCreateTeam = (caps?.manageableWorkspaces.length ?? 0) > 0
  const canCreateWorkspace = caps?.canCreateWorkspace === true

  return (
    <>
      <PanelHeader
        actions={
          <>
            {canCreateWorkspace ? (
              <Button size="sm" onClick={() => setDialog('workspace')}>
                New workspace
              </Button>
            ) : null}
            {canCreateTeam ? (
              <Button size="sm" variant="primary" onClick={() => setDialog('team')}>
                New team
              </Button>
            ) : null}
          </>
        }
      >
        <TeamBreadcrumbs items={[{ label: 'Teams' }]} />
      </PanelHeader>
      <div className={styles.content}>
        <Text as="p" variant="small" tone="secondary">
          Each team receives screenshot builds from one repository’s CI.
        </Text>
        {caps?.refusingWorkspaces.map((o) => (
          <Banner key={o.name}>
            {o.name} only shows its teams to people who signed in with{' '}
            {o.accepts.length > 0
              ? o.accepts.map((m) => (m === 'email' ? 'an email code' : 'a password')).join(' or ')
              : 'another method'}
            . Sign out and sign in that way to see them.
          </Banner>
        ))}
        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !data ? (
          <Delayed>
            <ListSkeleton rows={3} />
          </Delayed>
        ) : data.teams.length === 0 ? (
          <EmptyState
            icon={<FolderOpenIcon size={32} />}
            title="Create your first team"
            action={
              canCreateTeam ? (
                <Button variant="primary" onClick={() => setDialog('team')}>
                  New team
                </Button>
              ) : canCreateWorkspace ? (
                <Button variant="primary" onClick={() => setDialog('workspace')}>
                  New workspace
                </Button>
              ) : undefined
            }
          >
            {canCreateTeam
              ? 'A team holds the screenshot builds of one repository. Create one, then add its CI token to your CI.'
              : canCreateWorkspace
                ? 'Create a workspace first, then add a team to it.'
                : 'You aren’t an owner or admin of any workspace yet. Ask one to add you, or to create a team.'}
          </EmptyState>
        ) : (
          <ul aria-label="Teams" className={styles.list}>
            {data.teams.map(({ workspace, team, latestBuild }) => {
              const state = latestBuild ? buildState(latestBuild) : null
              return (
                <li key={`${workspace.slug}/${team.slug}`}>
                  <ListRow
                    className={styles.row}
                    {...clientLink({
                      to: '/$workspace/$team',
                      params: { workspace: workspace.slug, team: team.slug },
                    })}
                    leading={
                      state ? (
                        <StatusIcon status={state.status} label={state.label} />
                      ) : (
                        <StatusIcon status="neutral" label="No builds yet" />
                      )
                    }
                    trailing={
                      latestBuild ? (
                        <span className={styles.trailing}>
                          <CountsSummary
                            counts={latestBuild.counts}
                            review={shotReview(latestBuild)}
                            includeUnchanged={false}
                          />
                        </span>
                      ) : undefined
                    }
                  >
                    <span className={styles.title}>
                      <span className={styles.workspace}>{workspace.name} / </span>
                      {team.name}
                    </span>
                    <div className={styles.meta}>
                      {latestBuild ? (
                        <BuildMeta build={latestBuild} />
                      ) : (
                        <Text variant="small" tone="secondary">
                          No builds yet
                        </Text>
                      )}
                    </div>
                  </ListRow>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <NewWorkspaceDialog open={dialog === 'workspace'} onClose={() => setDialog(null)} />
      <NewTeamDialog
        open={dialog === 'team'}
        onClose={() => setDialog(null)}
        workspaces={caps?.manageableWorkspaces ?? []}
      />
    </>
  )
}
