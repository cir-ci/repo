import type { Team } from '@circi/api'
import { Avatar, Button, ChevronLeftIcon } from '@circi/ui'

import { TEAM_SETTINGS_PAGES, type TeamSettingsKey } from '#app/shell-model.ts'
import { memberCountLabel } from '#features/teams/AvatarStack.tsx'
import { useClientLink } from '#lib/use-client-link.ts'

import styles from './TeamHeader.module.css'

/** The tabs people who can't change a team's settings still have. */
const MEMBER_TABS: ReadonlySet<TeamSettingsKey> = new Set(['members', 'ignore-regions'])

const PATHS = {
  general: '/$workspace/$team/settings',
  members: '/$workspace/$team/settings/members',
  token: '/$workspace/$team/settings/token',
  reviews: '/$workspace/$team/settings/reviews',
  webhooks: '/$workspace/$team/settings/webhooks',
  'ignore-regions': '/$workspace/$team/settings/ignore-regions',
} as const satisfies Record<TeamSettingsKey, string>

/**
 * The header of a team's settings (the canvas's TeamMembers board): a way back to Teams, the team's
 * tile, name and member count, then the tabs: General, Members, CI token, Reviews and triage,
 * Webhooks, Ignore regions and Sites, which is the team's own page. Members of the team who can't
 * change its settings get Members and Ignore regions only.
 */
export function TeamHeader({
  workspace,
  team,
  name,
  color,
  icon,
  memberCount,
  canManage,
  active,
}: TeamHeader.Props) {
  const clientLink = useClientLink()
  const params = { workspace, team }
  const tabs = TEAM_SETTINGS_PAGES.filter((p) => canManage || MEMBER_TABS.has(p.key))
  return (
    <div className={styles.root}>
      <div className={styles.line}>
        <Button
          size="sm"
          variant="ghost"
          {...clientLink({ to: '/workspaces/$workspace/settings/teams', params: { workspace } })}
        >
          <ChevronLeftIcon size={14} />
          Teams
        </Button>
        <Avatar
          type="team"
          aria-hidden
          slug={team}
          name={name}
          color={color}
          icon={icon}
          size={24}
        />
        <span className={styles.name}>{name}</span>
        {memberCount === undefined ? null : (
          <span className={styles.count}>{memberCountLabel(memberCount)}</span>
        )}
      </div>
      <nav className={styles.tabs} aria-label={`${name} settings`}>
        {tabs.map((tab) => (
          <a
            key={tab.key}
            className={styles.tab}
            aria-current={tab.key === active ? 'page' : undefined}
            {...clientLink({ to: PATHS[tab.key], params })}
          >
            {tab.label}
          </a>
        ))}
        {canManage ? (
          <a className={styles.tab} {...clientLink({ to: '/$workspace/$team/sites', params })}>
            Sites
          </a>
        ) : null}
      </nav>
    </div>
  )
}

export namespace TeamHeader {
  export interface Props {
    workspace: string
    /** The team's slug. */
    team: string
    name: string
    color: Team.Color
    icon: string | null
    /** Shown beside the name when known. */
    memberCount?: number | undefined
    canManage: boolean
    /** The open tab. */
    active: TeamSettingsKey | undefined
  }
}
