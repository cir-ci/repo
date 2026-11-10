import { Badge, EmptyState, ListRow, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { baselineLink } from '#features/baselines/links.ts'
import { TeamSettingsFrame } from '#features/team-settings/TeamSettingsFrame.tsx'
import { ignoreRegionsQuery } from '#features/teams/api/index.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { useClientLink } from '#lib/use-client-link.ts'

import styles from './IgnoreRegionsPage.module.css'

/**
 * Team settings, Ignore regions: a read-only overview of every screenshot that has ignore
 * regions, each linking to its baseline page, where the regions are seen and edited.
 */
export function IgnoreRegionsPage() {
  const { workspace, team } = useParams({ from: '/$workspace/$team/settings/ignore-regions' })
  return (
    <TeamSettingsFrame workspace={workspace} team={team} page="Ignore regions" managersOnly={false}>
      {(_settings, teamName) => <Overview workspace={workspace} team={team} teamName={teamName} />}
    </TeamSettingsFrame>
  )
}

function Overview({ workspace, team, teamName }: Overview.Props) {
  const { data, error, refetch } = useQuery(ignoreRegionsQuery(workspace, team))
  const clientLink = useClientLink()
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!data) return null
  const shots = data.snapshots.filter((s) => s.regions > 0)
  return (
    <>
      <Text as="p" tone="secondary" className={styles.lead}>
        Parts of a screenshot CirCI blanks out on both images before comparing, such as clocks, ads
        or charts with live data. Regions belong to a screenshot name and apply to every build of{' '}
        {teamName}. Open a screenshot to see and edit its regions on its baseline page.
      </Text>
      {shots.length === 0 ? (
        <EmptyState title="No ignore regions yet">
          Add one from a screenshot’s baseline page: open it from Baselines, or from a flaky
          screenshot’s link on the team page.
        </EmptyState>
      ) : (
        <ul aria-label="Screenshots with ignore regions" className={styles.list}>
          {shots.map((s) => (
            <li key={s.name}>
              <ListRow
                {...clientLink(baselineLink(workspace, team, s.name))}
                trailing={
                  <Badge aria-label={`${s.regions} ${s.regions === 1 ? 'region' : 'regions'}`}>
                    {s.regions}
                  </Badge>
                }
              >
                <Text variant="mono" truncate>
                  {s.name}
                </Text>
              </ListRow>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

namespace Overview {
  export interface Props {
    workspace: string
    team: string
    teamName: string
  }
}
