import {
  GlobeIcon,
  KeyIcon,
  EyeIcon,
  SettingsLinkRow,
  SettingsSection,
  SlidersIcon,
  SquareDashedIcon,
  UsersIcon,
  WebhookIcon,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import type { ProjectsettingsKey } from '#app/shell-model.ts'
import { ignoreRegionsQuery, projectsQuery } from '#features/projects/api/index.ts'
import { rulesQuery } from '#features/reviews/settings/api.ts'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { useClientLink } from '#lib/use-client-link.ts'

import { hubGroups } from './hub-model.ts'
import { ProjectsettingsFrame } from './ProjectsettingsFrame.tsx'

const PATHS = {
  general: '/$workspace/$project/settings/general',
  members: '/$workspace/$project/settings/members',
  token: '/$workspace/$project/settings/token',
  reviews: '/$workspace/$project/settings/reviews',
  webhooks: '/$workspace/$project/settings/webhooks',
  'ignore-regions': '/$workspace/$project/settings/ignore-regions',
  sites: '/$workspace/$project/settings/sites',
} as const satisfies Record<ProjectsettingsKey, string>

const ICONS: Record<ProjectsettingsKey, ReactNode> = {
  general: <SlidersIcon />,
  members: <UsersIcon />,
  token: <KeyIcon />,
  reviews: <EyeIcon />,
  'ignore-regions': <SquareDashedIcon />,
  webhooks: <WebhookIcon />,
  sites: <GlobeIcon />,
}

/**
 * A project's settings hub (the canvas's ProjectsettingsHub board): the project's name and size, then one
 * row for each settings page the person has, in groups (Project, Reviews, Connections), each with a
 * one-line summary of what is set. Members of the project who can't change its settings get Members
 * and Ignore regions. Every summary comes from data the dashboard already reads: the projects list,
 * the project's settings (webhooks), the sidebar (sites), the rules and the ignore regions.
 */
export function ProjectsettingsHubPage() {
  const { workspace, project } = useParams({ from: '/$workspace/$project/settings' })
  return (
    <ProjectsettingsFrame workspace={workspace} project={project} managersOnly={false}>
      {(data) => (
        <Hub
          workspace={workspace}
          project={project}
          canManage={data.canManage}
          webhookCount={data.webhooks.length}
        />
      )}
    </ProjectsettingsFrame>
  )
}

function Hub({ workspace, project, canManage, webhookCount }: Hub.Props) {
  const clientLink = useClientLink()
  const { data: overview } = useQuery(projectsQuery())
  const { data: sidebar } = useSidebarModel(workspace)
  const { data: rules } = useQuery({ ...rulesQuery(workspace, project), enabled: canManage })
  const { data: regions } = useQuery(ignoreRegionsQuery(workspace, project))
  const memberCount = overview?.projects.find(
    (o) => o.workspace.slug === workspace && o.project.slug === project,
  )?.project.memberCount
  const groups = hubGroups({
    canManage,
    memberCount,
    ruleCount: rules?.rules.length,
    regionCount: regions?.regions.length,
    webhookCount,
    siteCount: sidebar?.projects.find((t) => t.slug === project)?.siteCount,
  })
  return (
    <>
      {groups.map((group) => (
        <SettingsSection key={group.title} title={group.title}>
          {group.rows.map((row) => (
            <SettingsLinkRow
              key={row.key}
              icon={ICONS[row.key]}
              label={row.label}
              detail={row.detail}
              value={row.value}
              {...clientLink({ to: PATHS[row.key], params: { workspace, project } })}
            />
          ))}
        </SettingsSection>
      ))}
    </>
  )
}

namespace Hub {
  export interface Props {
    workspace: string
    project: string
    canManage: boolean
    webhookCount: number
  }
}
