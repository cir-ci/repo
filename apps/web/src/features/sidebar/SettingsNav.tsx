import {
  ActivityIcon,
  BellIcon,
  BlocksIcon,
  BuildingIcon,
  ChevronLeftIcon,
  DatabaseIcon,
  KeyboardIcon,
  KeyIcon,
  NavSection,
  ReviewIcon,
  ScanIcon,
  ServerIcon,
  ShieldCheckIcon,
  SlidersIcon,
  SunIcon,
  Avatar,
  UserIcon,
  UserPlusIcon,
  UsersIcon,
  WebhookIcon,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useRouterState, useParams } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { NavLink } from '#app/NavLink.tsx'
import {
  orderTeams,
  pickSettingsTeam,
  readRememberedTeam,
  settingsNavTeams,
  TEAM_SETTINGS_PAGES,
  teamSettingsKey,
  type TeamSettingsKey,
} from '#app/shell-model.ts'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { capabilitiesQuery, teamsQuery } from '#features/teams/api/index.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'

import { TeamSwitcher } from './TeamSwitcher.tsx'
import { useWorkspaces } from './use-workspaces.ts'

import styles from './SettingsNav.module.css'

const TEAM_ICON: Record<TeamSettingsKey, ReactNode> = {
  general: <SlidersIcon />,
  token: <KeyIcon />,
  reviews: <ReviewIcon />,
  webhooks: <WebhookIcon />,
  'ignore-regions': <ScanIcon />,
}

const TEAM_PATH = {
  general: '/$workspace/$team/settings',
  token: '/$workspace/$team/settings/token',
  reviews: '/$workspace/$team/settings/reviews',
  webhooks: '/$workspace/$team/settings/webhooks',
  'ignore-regions': '/$workspace/$team/settings/ignore-regions',
} as const

/**
 * The left column of every settings page (the canvas's SettingsNav board), in place of the
 * sidebar: Back to app, then Account, Workspace, Team (with a team switcher in its header) and,
 * for the people who run the instance, Instance. The workspace is the one in the address, else the
 * last chosen; the team is the one in the address, else the last one used here, else the first.
 */
export function SettingsNav() {
  const { data: caps } = useQuery(capabilitiesQuery())
  const params = useParams({ strict: false })
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { workspace } = useWorkspaces(useChosenWorkspace())
  const { data: model } = useSidebarModel(workspace?.slug)
  const { data: overview } = useQuery(teamsQuery())
  // Only teams that exist in this workspace now: never one remembered from, or cached for, another.
  const routeTeam = workspace && params.workspace === workspace.slug ? params.team : undefined
  const teams = orderTeams(
    settingsNavTeams(model?.teams ?? [], overview?.teams, workspace?.slug ?? '', routeTeam),
  )
  // The team in the address is the one whose settings are open: never swapped for another while
  // the lists catch up after a rename (nothing is shown until one of them knows it).
  const team = workspace
    ? routeTeam !== undefined
      ? teams.find((t) => t.slug === routeTeam)
      : pickSettingsTeam(teams, undefined, readRememberedTeam(workspace.slug))
    : undefined
  const teamKey = teamSettingsKey(pathname)
  // Settings only owners and admins can change are left out for everyone else (their pages send them away).
  const canManage = model?.canManage === true

  return (
    <>
      <NavLink to="/inbox" icon={<ChevronLeftIcon />} selected={false}>
        Back to app
      </NavLink>
      <NavSection label="Account">
        <NavLink to="/account/profile" icon={<UserIcon />}>
          Profile
        </NavLink>
        <NavLink to="/account/notifications" icon={<BellIcon />}>
          Notifications
        </NavLink>
        <NavLink to="/account/appearance" icon={<SunIcon />}>
          Appearance
        </NavLink>
        <NavLink to="/account/shortcuts" icon={<KeyboardIcon />}>
          Keyboard shortcuts
        </NavLink>
      </NavSection>
      {workspace ? (
        <NavSection
          label={
            <>
              <Avatar
                type="workspace"
                aria-hidden
                slug={workspace.slug}
                name={workspace.name}
                picture={workspace.picture ?? null}
                size={16}
              />
              {`Workspace · ${workspace.name}`}
            </>
          }
        >
          {canManage ? (
            <NavLink
              to="/workspaces/$workspace/settings"
              params={{ workspace: workspace.slug }}
              icon={<BuildingIcon />}
            >
              General
            </NavLink>
          ) : null}
          <NavLink
            to="/workspaces/$workspace/settings/members"
            params={{ workspace: workspace.slug }}
            icon={<UsersIcon />}
          >
            Members
          </NavLink>
          {canManage ? (
            <NavLink
              to="/workspaces/$workspace/settings/sign-in"
              params={{ workspace: workspace.slug }}
              icon={<ShieldCheckIcon />}
            >
              Sign-in and domains
            </NavLink>
          ) : null}
          {canManage ? (
            <NavLink
              to="/workspaces/$workspace/settings/integrations"
              params={{ workspace: workspace.slug }}
              icon={<BlocksIcon />}
              selected={pathname.startsWith(
                `/workspaces/${encodeURIComponent(workspace.slug)}/settings/integrations`,
              )}
            >
              Integrations
            </NavLink>
          ) : null}
          {canManage ? (
            <NavLink
              to="/workspaces/$workspace/settings/storage"
              params={{ workspace: workspace.slug }}
              icon={<DatabaseIcon />}
            >
              Storage and retention
            </NavLink>
          ) : null}
        </NavSection>
      ) : null}
      {workspace && team ? (
        <NavSection
          label={
            <>
              <Avatar
                type="team"
                aria-hidden
                slug={team.slug}
                name={team.name}
                color={team.color}
                icon={team.icon}
              />
              <span className={styles.teamName}>{`Team · ${team.name}`}</span>
            </>
          }
          actions={<TeamSwitcher workspace={workspace.slug} teams={teams} current={team.slug} />}
        >
          {TEAM_SETTINGS_PAGES.filter(({ key }) => canManage || key === 'ignore-regions').map(
            ({ key, label }) => (
              <NavLink
                key={key}
                to={TEAM_PATH[key]}
                params={{ workspace: workspace.slug, team: team.slug }}
                icon={TEAM_ICON[key]}
                selected={team.slug === params.team && teamKey === key}
              >
                {label}
              </NavLink>
            ),
          )}
        </NavSection>
      ) : null}
      {caps?.instanceAdmin ? (
        <NavSection
          label={
            <>
              <span className={styles.teamName}>Instance</span>
              <span className={styles.note}>Admins only</span>
            </>
          }
        >
          <NavLink to="/instance/accounts" icon={<UserPlusIcon />}>
            Accounts
          </NavLink>
          <NavLink to="/instance/workspaces" icon={<BuildingIcon />}>
            Workspaces
          </NavLink>
          <NavLink to="/instance/settings" icon={<ServerIcon />}>
            Instance settings
          </NavLink>
          <NavLink to="/instance/health" icon={<ActivityIcon />}>
            Health
          </NavLink>
        </NavSection>
      ) : null}
    </>
  )
}
