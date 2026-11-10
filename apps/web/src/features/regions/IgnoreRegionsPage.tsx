import { Badge, EmptyState, ListRow, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { TeamSettingsFrame } from '#features/team-settings/TeamSettingsFrame.tsx'
import { ignoreRegionsQuery } from '#features/teams/api/index.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { useClientLink } from '#lib/use-client-link.ts'

import { ignoreRegionLink } from './links.ts'
import { OVERVIEW_ROUTE } from './routes.ts'

import styles from './IgnoreRegionsPage.module.css'

/**
 * Team settings, Ignore regions: a read-only overview of every screenshot that has ignore
 * regions, each opening its baseline here in settings, where the regions are seen and edited.
 */
export function IgnoreRegionsPage() {
  const { workspace, team } = useParams({ from: OVERVIEW_ROUTE })
  return (
    <TeamSettingsFrame workspace={workspace} team={team} page="Ignore regions" managersOnly={false}>
      {() => <Overview workspace={workspace} team={team} />}
    </TeamSettingsFrame>
  )
}

function Overview({ workspace, team }: Overview.Props) {
  const { data, error, refetch } = useQuery(ignoreRegionsQuery(workspace, team))
  const clientLink = useClientLink()
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!data) return null
  const shots = data.snapshots.filter((s) => s.regions > 0)
  return (
    <>
      {shots.length === 0 ? (
        <EmptyState title="No ignore regions yet">
          Add one from a screenshot's baseline page.
        </EmptyState>
      ) : (
        <ul aria-label="Screenshots with ignore regions" className={styles.list}>
          {shots.map((s) => (
            <li key={s.name}>
              <ListRow
                {...clientLink(ignoreRegionLink(workspace, team, s.name))}
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
  }
}
