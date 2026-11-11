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

import type { TeamSettingsKey } from '#app/shell-model.ts'
import { rulesQuery } from '#features/reviews/settings/api.ts'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { ignoreRegionsQuery, teamsQuery } from '#features/teams/api/index.ts'
import { useClientLink } from '#lib/use-client-link.ts'

import { hubGroups } from './hub-model.ts'
import { TeamSettingsFrame } from './TeamSettingsFrame.tsx'

const PATHS = {
  general: '/$workspace/$team/settings/general',
  members: '/$workspace/$team/settings/members',
  token: '/$workspace/$team/settings/token',
  reviews: '/$workspace/$team/settings/reviews',
  webhooks: '/$workspace/$team/settings/webhooks',
  'ignore-regions': '/$workspace/$team/settings/ignore-regions',
  sites: '/$workspace/$team/settings/sites',
} as const satisfies Record<TeamSettingsKey, string>

const ICONS: Record<TeamSettingsKey, ReactNode> = {
  general: <SlidersIcon />,
  members: <UsersIcon />,
  token: <KeyIcon />,
  reviews: <EyeIcon />,
  'ignore-regions': <SquareDashedIcon />,
  webhooks: <WebhookIcon />,
  sites: <GlobeIcon />,
}

/**
 * A team's settings hub (the canvas's TeamSettingsHub board): the team's name and size, then one
 * row for each settings page the person has, in groups (Team, Reviews, Connections), each with a
 * one-line summary of what is set. Members of the team who can't change its settings get Members
 * and Ignore regions. Every summary comes from data the dashboard already reads: the teams list,
 * the team's settings (webhooks), the sidebar (sites), the rules and the ignore regions.
 */
export function TeamSettingsHubPage() {
  const { workspace, team } = useParams({ from: '/$workspace/$team/settings' })
  return (
    <TeamSettingsFrame workspace={workspace} team={team} managersOnly={false}>
      {(data) => (
        <Hub
          workspace={workspace}
          team={team}
          canManage={data.canManage}
          webhookCount={data.webhooks.length}
        />
      )}
    </TeamSettingsFrame>
  )
}

function Hub({ workspace, team, canManage, webhookCount }: Hub.Props) {
  const clientLink = useClientLink()
  const { data: overview } = useQuery(teamsQuery())
  const { data: sidebar } = useSidebarModel(workspace)
  const { data: rules } = useQuery({ ...rulesQuery(workspace, team), enabled: canManage })
  const { data: regions } = useQuery(ignoreRegionsQuery(workspace, team))
  const memberCount = overview?.teams.find(
    (o) => o.workspace.slug === workspace && o.team.slug === team,
  )?.team.memberCount
  const groups = hubGroups({
    canManage,
    memberCount,
    ruleCount: rules?.rules.length,
    regionCount: regions?.regions.length,
    webhookCount,
    siteCount: sidebar?.teams.find((t) => t.slug === team)?.siteCount,
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
              {...clientLink({ to: PATHS[row.key], params: { workspace, team } })}
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
    team: string
    canManage: boolean
    webhookCount: number
  }
}
