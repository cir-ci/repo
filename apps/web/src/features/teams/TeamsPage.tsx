import { Banner, Button, Delayed, ListRow, ListSkeleton, StatusIcon, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { buildState } from '#features/builds/build-state.ts'
import { BuildMeta } from '#features/builds/BuildMeta.tsx'
import { CountsSummary } from '#features/builds/CountsSummary.tsx'
import { shotReview } from '#features/builds/diff-status.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { PageHeading } from '#lib/PageHeading.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useClientLink } from '#lib/use-client-link.ts'

import { capabilitiesQuery, teamsQuery } from './api.ts'
import { useLoadingAnnouncement } from './loading.ts'
import { TeamsEmpty } from './TeamsEmpty.tsx'

import styles from './TeamsPage.module.css'

const ACCEPTS_TEXT = {
  email: 'an email code',
  password: 'a password',
  github: 'GitHub',
  google: 'Google',
} as const

export function TeamsPage() {
  useDocumentTitle('Teams')
  const clientLink = useClientLink()
  const { data, error, refetch } = useQuery(teamsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const setNewTeamOpen = useOverlayStore((s) => s.setNewTeamOpen)
  const setNewWorkspaceOpen = useOverlayStore((s) => s.setNewWorkspaceOpen)
  useLoadingAnnouncement(!data && !error, 'Loading teams')
  const canCreateTeam = (caps?.manageableWorkspaces.length ?? 0) > 0
  const canCreateWorkspace = caps?.canCreateWorkspace === true

  return (
    <>
      <PageHeading
        title="Teams"
        actions={
          <>
            {canCreateWorkspace ? (
              <Button size="sm" onClick={() => setNewWorkspaceOpen(true)}>
                New workspace
              </Button>
            ) : null}
            {canCreateTeam ? (
              <Button size="sm" variant="primary" onClick={() => setNewTeamOpen(true)}>
                New team
              </Button>
            ) : null}
          </>
        }
      />
      <div className={styles.content}>
        <Text as="p" variant="small" tone="secondary">
          Each team receives screenshot builds from one repository’s CI.
        </Text>
        {caps?.refusingWorkspaces.map((o) => (
          <Banner key={o.name}>
            {o.name} only shows its teams to people who signed in with{' '}
            {o.accepts.length > 0
              ? o.accepts.map((m) => ACCEPTS_TEXT[m]).join(' or ')
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
          <TeamsEmpty canCreateTeam={canCreateTeam} canCreateWorkspace={canCreateWorkspace} />
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
    </>
  )
}
