import type { InstanceAdmin } from '@circi/api'
import {
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
  UsersIcon,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useRouterState } from '@tanstack/react-router'

import { NavLink } from '#app/NavLink.tsx'
import { returnTarget } from '#app/settings-return.ts'
import { workspacesQuery } from '#features/instance/api/admin.ts'
import { onInstancePage } from '#features/instance/hub-model.ts'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { capabilitiesQuery } from '#features/teams/api/index.ts'
import { useSettingsReturnStore } from '#lib/stores/settings-return-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'
import { usePhone } from '#lib/use-phone.ts'

import { useWorkspaces } from './use-workspaces.ts'

import styles from './SettingsNav.module.css'

/**
 * The left column of every settings page (the canvas's SettingsNav board), in place of the
 * sidebar: the way back to the page you came from, then Account, Workspace (General, Members, ...), Teams
 * (each team the person may see, opening its settings hub, then All teams) and, for the people
 * who run the instance, Instance, above Workspaces and Teams (the hierarchy: Account, Instance,
 * Workspaces, Teams): one entry (a tile and its name) that opens the Instance hub and
 * stays selected on every Instance page but All workspaces. A team stays selected on every page of its settings. The workspace is the one in the address, else the last chosen.
 * Instance admins get a Workspaces section (every live workspace of the instance, each opening its
 * settings hub and selected on every page of it, then All workspaces: the list, with New workspace
 * and the deleted ones) in place of the Workspace one. On a
 * phone it is the body of the settings sections sheet (`SettingsSections`): no Back row (the
 * header's Close is the way out) and no Hide button.
 */
export function SettingsNav() {
  const phone = usePhone()
  const { data: caps } = useQuery(capabilitiesQuery())
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { workspace } = useWorkspaces(useChosenWorkspace())
  const { data: model } = useSidebarModel(workspace?.slug)
  // Instance admins get every workspace of the instance in place of the one's section.
  const { data: instanceList } = useQuery({
    ...workspacesQuery(),
    enabled: caps?.instanceAdmin === true,
  })
  const instanceWorkspaces = (instanceList?.workspaces ?? [])
    .filter((w) => !w.deletedAt)
    .toSorted(byName)
  const router = useRouter()
  const back = returnTarget(
    useSettingsReturnStore((s) => s.app),
    model?.teams,
  )
  // Settings only owners and admins can change are left out for everyone else (their pages send them away).
  const canManage = model?.canManage === true

  return (
    <>
      {phone ? null : (
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
        </div>
      )}
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
        {phone ? null : (
          <NavLink to="/account/shortcuts" icon={<KeyboardIcon />}>
            Keyboard shortcuts
          </NavLink>
        )}
      </NavSection>
      {caps?.instanceAdmin ? (
        <NavSection label="Instance">
          <NavLink
            to="/instance/overview"
            icon={
              <span className={styles.instanceTile} aria-hidden>
                <ServerIcon size={13} />
              </span>
            }
            // Every Instance page belongs to this entry (the hub, Accounts, Instance settings, Health,
            // ...) except All workspaces, which belongs to the Workspaces section.
            selected={onInstancePage(pathname)}
          >
            Instance
          </NavLink>
        </NavSection>
      ) : null}
      {caps?.instanceAdmin ? (
        <>
          <NavSection label="Workspaces">
            {instanceWorkspaces.map((w) => (
              <WorkspaceEntry key={w.slug} workspace={w} pathname={pathname} />
            ))}
            <NavLink
              to="/instance/workspaces"
              icon={<BuildingIcon />}
              selected={pathname === '/instance/workspaces'}
            >
              All workspaces
            </NavLink>
          </NavSection>
        </>
      ) : workspace ? (
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
              to="/workspaces/$workspace/settings/general"
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
      {workspace ? (
        <NavSection label="Teams">
          {(model?.teams ?? []).map((team) => {
            const base = `/${encodeURIComponent(workspace.slug)}/${encodeURIComponent(team.slug)}/settings`
            return (
              <NavLink
                key={team.slug}
                to="/$workspace/$team/settings"
                params={{ workspace: workspace.slug, team: team.slug }}
                icon={
                  <Avatar
                    type="team"
                    aria-hidden
                    slug={team.slug}
                    name={team.name}
                    color={team.color}
                    icon={team.icon}
                    size={18}
                  />
                }
                // Every page of the team's settings belongs to its entry: the hub and the pages below it.
                selected={pathname === base || pathname.startsWith(`${base}/`)}
              >
                {team.name}
              </NavLink>
            )
          })}
          <NavLink
            to="/workspaces/$workspace/settings/teams"
            params={{ workspace: workspace.slug }}
            icon={<LayersIcon />}
            selected={
              pathname === `/workspaces/${encodeURIComponent(workspace.slug)}/settings/teams`
            }
          >
            All teams
          </NavLink>
        </NavSection>
      ) : null}
    </>
  )
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

/** A workspace of the instance (an instance admin's list): its tile and name, opening its settings hub. */
function WorkspaceEntry({ workspace, pathname }: WorkspaceEntry.Props) {
  const base = `/workspaces/${encodeURIComponent(workspace.slug)}/settings`
  return (
    <NavLink
      to="/workspaces/$workspace/settings"
      params={{ workspace: workspace.slug }}
      icon={
        <Avatar
          type="workspace"
          aria-hidden
          slug={workspace.slug}
          name={workspace.name}
          picture={workspace.picture}
          size={20}
        />
      }
      // Every page of the workspace's settings belongs to its entry: the hub and the pages below
      // it, except the teams list, which belongs to "All teams" (one selected entry per page).
      selected={
        (pathname === base || pathname.startsWith(`${base}/`)) &&
        pathname !== `${base}/teams` &&
        !pathname.startsWith(`${base}/teams/`)
      }
    >
      {workspace.name}
    </NavLink>
  )
}

namespace WorkspaceEntry {
  export interface Props {
    workspace: Pick<InstanceAdmin.Workspace, 'slug' | 'name' | 'picture'>
    pathname: string
  }
}
