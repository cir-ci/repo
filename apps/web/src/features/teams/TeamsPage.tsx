import { Banner, Button, ListRow, StatusIcon, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { buildState } from '#features/builds/build-state.ts'
import { BuildMeta } from '#features/builds/BuildMeta.tsx'
import { CountsSummary } from '#features/builds/CountsSummary.tsx'
import { shotReview } from '#features/builds/diff-status.ts'
import { capabilitiesQuery, teamsQuery } from '#features/teams/api/index.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useClientLink } from '#lib/use-client-link.ts'

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
  const query = useQuery(teamsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const setNewTeamOpen = useOverlayStore((s) => s.setNewTeamOpen)
  const canCreateTeam = (caps?.manageableWorkspaces.length ?? 0) > 0
  const canCreateWorkspace = caps?.canCreateWorkspace === true

  return (
    <>
      <PageHeading
        title="Teams"
        actions={
          <>
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
        <QueryBoundary query={query} announce="Loading teams" rows={3}>
          {(data) =>
            data.teams.length === 0 ? (
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
            )
          }
        </QueryBoundary>
      </div>
    </>
  )
}
