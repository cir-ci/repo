import {
  ActivityIcon,
  BellIcon,
  BlocksIcon,
  BuildingIcon,
  ChevronLeftIcon,
  DatabaseIcon,
  KeyboardIcon,
  LayersIcon,
  NavItem,
  NavSection,
  ServerIcon,
  ShieldCheckIcon,
  SunIcon,
  Avatar,
  UserIcon,
  UserPlusIcon,
  UsersIcon,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useRouterState } from '@tanstack/react-router'

import { NavLink } from '#app/NavLink.tsx'
import { HideNavButton } from '#app/NavToggle.tsx'
import { returnTarget } from '#app/settings-return.ts'
import { currentSection } from '#app/shell-model.ts'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { capabilitiesQuery } from '#features/teams/api/index.ts'
import { useSettingsReturnStore } from '#lib/stores/settings-return-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'

import { useWorkspaces } from './use-workspaces.ts'

import styles from './SettingsNav.module.css'

/**
 * The left column of every settings page (the canvas's SettingsNav board), in place of the
 * sidebar: the way back to the page you came from, then Account, Workspace (General, Members, Teams, ...) and, for the people
 * who run the instance, Instance. A team's own settings are not listed here: Teams opens them (a
 * team header with tabs). The workspace is the one in the address, else the last chosen.
 */
export function SettingsNav() {
  const { data: caps } = useQuery(capabilitiesQuery())
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { workspace } = useWorkspaces(useChosenWorkspace())
  const { data: model } = useSidebarModel(workspace?.slug)
  const router = useRouter()
  const back = returnTarget(
    useSettingsReturnStore((s) => s.app),
    model?.teams,
  )
  // A team's settings (`/<workspace>/<team>/settings/...`) belong to the Teams entry.
  const teamsSelected = currentSection(pathname) === 'team-settings'
  // Settings only owners and admins can change are left out for everyone else (their pages send them away).
  const canManage = model?.canManage === true

  return (
    <>
      <div className={styles.header}>
        <div className={styles.back}>
          <NavItem
            href={back.path}
            icon={<ChevronLeftIcon />}
            onClick={(e) => {
              // A plain click goes through the router (no reload); a new-tab click keeps the link.
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              router.history.push(back.path)
            }}
          >
            {`Back to ${back.label}`}
          </NavItem>
        </div>
        <HideNavButton />
      </div>
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
                size={20}
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
          <NavLink
            to="/workspaces/$workspace/settings/teams"
            params={{ workspace: workspace.slug }}
            icon={<LayersIcon />}
            selected={
              teamsSelected ||
              pathname === `/workspaces/${encodeURIComponent(workspace.slug)}/settings/teams`
            }
          >
            Teams
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
