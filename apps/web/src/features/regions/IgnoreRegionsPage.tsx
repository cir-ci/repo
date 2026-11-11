import { Badge, EmptyState, ListRow, SquareDashedIcon } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { ProjectSettingsFrame } from '#features/project-settings/ProjectSettingsFrame.tsx'
import { ignoreRegionsQuery } from '#features/projects/api/index.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { useClientLink } from '#lib/use-client-link.ts'

import { ignoreRegionLink } from './links.ts'
import { OVERVIEW_ROUTE } from './routes.ts'

import styles from './IgnoreRegionsPage.module.css'

/**
 * Project settings, Ignore regions: a read-only overview of every screenshot that has ignore
 * regions, each opening its baseline here in settings, where the regions are seen and edited.
 */
export function IgnoreRegionsPage() {
  const { workspace, project } = useParams({ from: OVERVIEW_ROUTE })
  return (
    <ProjectSettingsFrame
      workspace={workspace}
      project={project}
      page="Ignore regions"
      managersOnly={false}
    >
      {() => <Overview workspace={workspace} project={project} />}
    </ProjectSettingsFrame>
  )
}

function Overview({ workspace, project }: Overview.Props) {
  const { data, error, refetch } = useQuery(ignoreRegionsQuery(workspace, project))
  const clientLink = useClientLink()
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!data) return null
  const shots = data.snapshots.filter((s) => s.regions > 0)
  return (
    <>
      {shots.length === 0 ? (
        <EmptyState icon={<SquareDashedIcon />} size="section" title="No ignore regions yet">
          Add one from a screenshot's baseline page.
        </EmptyState>
      ) : (
        <ul aria-label="Screenshots with ignore regions" className={styles.list}>
          {shots.map((s) => (
            <li key={s.name}>
              <ListRow
                {...clientLink(ignoreRegionLink(workspace, project, s.name))}
                title={s.name}
                density="two-line"
                trailing={
                  <Badge aria-label={`${s.regions} ${s.regions === 1 ? 'region' : 'regions'}`}>
                    {s.regions}
                  </Badge>
                }
              />
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
    project: string
  }
}
