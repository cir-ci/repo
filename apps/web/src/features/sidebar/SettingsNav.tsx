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
  ShieldCheckIcon,
  SunIcon,
  Avatar,
  UserIcon,
  UsersIcon,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { Fragment, type ReactNode, useState } from 'react'

import { NavLink } from '#app/NavLink.tsx'
import { returnTarget } from '#app/settings-return.ts'
import { PROJECT_SETTINGS_PAGES, type ProjectSettingsKey } from '#app/shell-model.ts'
import { workspacesQuery } from '#features/instance/api/admin.ts'
import { onInstancePage } from '#features/instance/hub-model.ts'
import { capabilitiesQuery } from '#features/projects/api/index.ts'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { useSettingsReturnStore } from '#lib/stores/settings-return-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'
import { usePhone } from '#lib/use-phone.ts'

import {
  currentSettingsGroup,
  orderedSettingsGroups,
  SETTINGS_GROUPS,
  type SettingsGroup,
} from './settings-nav-model.ts'
import { useWorkspaces } from './use-workspaces.ts'

import styles from './SettingsNav.module.css'

/**
 * The left column of every settings page (the canvas's SettingsNav board), in place of the
 * sidebar: the way back to the page you came from (settings' only one), then the section the page
 * belongs to, listed first and open (a project's tabs, or the workspace's pages), and the other
 * sections after it, folded: Account, Workspace (General, Members, ...), Projects
 * (each project the person may see, opening its settings hub, then All projects) and, for the people
 * who run the instance, Instance, above Workspaces and Projects (the hierarchy: Account, Instance,
 * Workspaces, Projects): one entry (a tile and its name) that opens the Instance hub and
 * stays selected on every Instance page but All workspaces. A project stays selected on every page of its settings. The workspace is the one in the address, else the last chosen.
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
    model?.projects,
  )
  // The section of the page being viewed is open and first; the others are folded until opened.
  const current = currentSettingsGroup(pathname)
  const [folds, setFolds] = useState<{
    current: SettingsGroup
    open: Partial<Record<SettingsGroup, boolean>>
  }>({
    current,
    open: {},
  })
  // Going to another group (a link in the page, a project's pages) starts over with that one open.
  if (folds.current !== current) setFolds({ current, open: {} })
  const fold = (group: SettingsGroup) => ({
    open: folds.open[group] ?? group === current,
    onOpenChange: (open: boolean) =>
      setFolds((f) => ({ ...f, open: { ...f.open, [group]: open } })),
  })
  // Settings only owners and admins can change are left out for everyone else (their pages send them away).
  const canManage = model?.canManage === true

  const account = (
    <NavSection label="Account" {...fold('account')}>
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
  )
  const instance = caps?.instanceAdmin ? (
    <NavSection label="Instance" {...fold('instance')}>
      <NavLink
        to="/instance/overview"
        icon={
          <Avatar
            type="instance"
            aria-hidden
            seed={window.location.host}
            name="Instance"
            size={18}
          />
        }
        // Every Instance page belongs to this entry (the hub, Accounts, Instance settings, Health,
        // ...) except All workspaces, which belongs to the Workspaces section.
        selected={onInstancePage(pathname)}
      >
        Instance
      </NavLink>
    </NavSection>
  ) : null
  const workspaceGroup = caps?.instanceAdmin ? (
    <>
      <NavSection label="Workspaces" {...fold('workspace')}>
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
      {...fold('workspace')}
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
  ) : null
  const projectsGroup = workspace ? (
    <NavSection label="Projects" {...fold('projects')}>
      {(model?.projects ?? []).map((project) => {
        const base = `/${encodeURIComponent(workspace.slug)}/${encodeURIComponent(project.slug)}/settings`
        const inside = pathname === base || pathname.startsWith(`${base}/`)
        return (
          <Fragment key={project.slug}>
            <NavLink
              to="/$workspace/$project/settings"
              params={{ workspace: workspace.slug, project: project.slug }}
              icon={
                <Avatar
                  type="project"
                  aria-hidden
                  slug={project.slug}
                  name={project.name}
                  color={project.color}
                  icon={project.icon}
                  size={18}
                />
              }
              // The project's entry is the current page on its hub; on a page below it the page's own
              // entry (under the project) is, and the project keeps the quieter highlight.
              selected={pathname === base}
              within={inside}
            >
              {project.name}
            </NavLink>
            {inside ? (
              <ProjectSections
                workspace={workspace.slug}
                project={project.slug}
                base={base}
                pathname={pathname}
                canManage={canManage}
              />
            ) : null}
          </Fragment>
        )
      })}
      <NavLink
        to="/workspaces/$workspace/settings/projects"
        params={{ workspace: workspace.slug }}
        icon={<LayersIcon />}
        selected={
          pathname === `/workspaces/${encodeURIComponent(workspace.slug)}/settings/projects`
        }
      >
        All projects
      </NavLink>
    </NavSection>
  ) : null

  const groups: Record<SettingsGroup, ReactNode> = {
    account,
    instance,
    workspace: workspaceGroup,
    projects: projectsGroup,
  }
  const present = new Set(SETTINGS_GROUPS.filter((g) => groups[g] !== null))

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
      {orderedSettingsGroups(current, present).map((group) => (
        <Fragment key={group}>{groups[group]}</Fragment>
      ))}
    </>
  )
}

const PROJECT_PAGE_PATHS = {
  general: '/$workspace/$project/settings/general',
  members: '/$workspace/$project/settings/members',
  token: '/$workspace/$project/settings/token',
  reviews: '/$workspace/$project/settings/reviews',
  webhooks: '/$workspace/$project/settings/webhooks',
  'ignore-regions': '/$workspace/$project/settings/ignore-regions',
  sites: '/$workspace/$project/settings/sites',
} as const satisfies Record<ProjectSettingsKey, string>

/** Pages of a project's settings every member has; the rest are for owners and admins. */
const MEMBER_PAGES: ReadonlySet<ProjectSettingsKey> = new Set(['members', 'ignore-regions'])

/**
 * The open project's settings pages (General, Members, CI token, ...) under its entry, so its
 * sub-pages have sibling navigation without leaving settings. Owners and admins get all of them,
 * members Members and Ignore regions (the hub's rule).
 */
function ProjectSections({
  workspace,
  project,
  base,
  pathname,
  canManage,
}: {
  workspace: string
  project: string
  base: string
  pathname: string
  canManage: boolean
}) {
  return PROJECT_SETTINGS_PAGES.filter((page) => canManage || MEMBER_PAGES.has(page.key)).map(
    (page) => (
      <NavLink
        key={page.key}
        sub
        to={PROJECT_PAGE_PATHS[page.key]}
        params={{ workspace, project }}
        selected={pathname === `${base}${page.path}` || pathname.startsWith(`${base}${page.path}/`)}
      >
        {page.label}
      </NavLink>
    ),
  )
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

/** Whether the address is a page inside the workspace that its own entry isn't selected for: a project's settings, or its projects list. */
export function insideWorkspace(pathname: string, slug: string): boolean {
  const ws = encodeURIComponent(slug)
  const [, first, second, third] = pathname.split('/')
  const projectSettings = first === ws && second !== undefined && third === 'settings'
  const projectsList =
    pathname === `/workspaces/${ws}/settings/projects` ||
    pathname.startsWith(`/workspaces/${ws}/settings/projects/`)
  return projectSettings || projectsList
}

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
      // it, except the projects list, which belongs to "All projects" (one selected entry per page).
      selected={
        (pathname === base || pathname.startsWith(`${base}/`)) &&
        pathname !== `${base}/projects` &&
        !pathname.startsWith(`${base}/projects/`)
      }
      // A page inside it that another entry is selected for (a project's settings, All projects):
      // the workspace is still the one being viewed, so it keeps a quieter highlight.
      within={insideWorkspace(pathname, workspace.slug)}
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
