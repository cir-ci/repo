import type { Sidebar as SidebarModel } from '@circi/api'
import {
  FolderOpenIcon,
  GlobeIcon,
  HammerIcon,
  ImageIcon,
  InboxIcon,
  InsightsIcon,
  Kbd,
  ListChecksIcon,
  ListFilterIcon,
  NavItem,
  NavSection,
  PinIcon,
  ReviewIcon,
  SearchIcon,
  Avatar,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router'

import { UserMenu } from '#features/auth/UserMenu.tsx'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { useWorkspaces } from '#features/sidebar/use-workspaces.ts'
import { WorkspaceSwitcher } from '#features/sidebar/WorkspaceSwitcher.tsx'
import { capabilitiesQuery, teamsQuery } from '#features/teams/api/index.ts'
import type { SessionUser } from '#lib/auth-client.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useWorkspaceStore, useChosenWorkspace } from '#lib/stores/workspace-store.ts'

import { NavLink } from './NavLink.tsx'
import {
  countOrUndefined,
  currentSection,
  type WorkspaceRef,
  pinnedViews,
  switchWorkspacePath,
  SIDEBAR_TEAM_LIMIT,
  sidebarTeams,
} from './shell-model.ts'

import styles from './Sidebar.module.css'

/**
 * Top to bottom (the canvas's Sidebar board): the workspace switcher, Search, Inbox, Reviews,
 * Teams, Insights, then the workspace's teams (Pinned, then Teams; the open one expands to Builds,
 * Triage, Baselines and Sites), "Your views", and the account button. With no teams the Teams
 * section says "No teams yet"; creating a team lives on the Teams page. No settings links:
 * workspace settings (and from there each team's) open from the workspace menu above, account
 * settings from the account menu. `AppFrame` wraps this in the Main navigation on wide screens;
 * the `Drawer` does on narrow ones.
 */
export function Sidebar({ user }: Sidebar.Props) {
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const section = currentSection(pathname)
  const setCommandMenuOpen = useOverlayStore((s) => s.setCommandMenuOpen)
  const setNewWorkspaceOpen = useOverlayStore((s) => s.setNewWorkspaceOpen)
  const chosen = useChosenWorkspace()
  const choose = useWorkspaceStore((s) => s.choose)
  const { workspaces, workspace } = useWorkspaces(chosen)
  const { data: overview } = useQuery(teamsQuery())
  const { data: model } = useSidebarModel(workspace?.slug)
  const { data: caps } = useQuery(capabilitiesQuery())
  const { shown, total } = sidebarTeams(model?.teams, SIDEBAR_TEAM_LIMIT, params.team)
  const pinned = shown.filter((team) => team.pinned)
  const others = shown.filter((team) => !team.pinned)
  const views = pinnedViews(model?.views)
  const openTeam = params.workspace === workspace?.slug ? params.team : undefined

  function switchWorkspace(next: WorkspaceRef) {
    choose(next.slug)
    // The same page in the new workspace; a team page goes to its last-used or first team there.
    const target = switchWorkspacePath(pathname, next.slug, (slug) => {
      const slugs = (overview?.teams ?? [])
        .filter((o) => o.workspace.slug === slug)
        .map((o) => o.team.slug)
      return slugs[0]
    })
    if (target) void navigate({ href: target })
  }

  const teamEntries = (list: SidebarModel.Team[]) =>
    workspace
      ? list.map((team) => (
          <TeamEntry
            key={team.slug}
            workspace={workspace.slug}
            team={team}
            open={openTeam === team.slug}
            section={section}
          />
        ))
      : null

  return (
    <>
      <div className={styles.header}>
        <div className={styles.switcher}>
          <WorkspaceSwitcher
            workspaces={workspaces}
            current={workspace}
            onSelect={switchWorkspace}
            canManage={model?.canManage}
            {...(caps?.canCreateWorkspace ? { onCreate: () => setNewWorkspaceOpen(true) } : {})}
          />
        </div>
      </div>
      <NavItem
        icon={<SearchIcon />}
        trailing={<Kbd>⌘K</Kbd>}
        onClick={() => setCommandMenuOpen(true)}
      >
        Search
      </NavItem>
      <NavLink
        to="/inbox"
        icon={<InboxIcon />}
        selected={section === 'inbox'}
        {...counted(model?.inboxUnread, 'unread notifications')}
      >
        Inbox
      </NavLink>
      {workspace ? (
        <NavLink
          to="/workspaces/$workspace/reviews"
          params={{ workspace: workspace.slug }}
          icon={<ReviewIcon />}
          selected={section === 'reviews'}
          {...counted(model?.reviews, 'reviews waiting')}
        >
          Reviews
        </NavLink>
      ) : null}
      <NavLink to="/" icon={<FolderOpenIcon />} selected={section === 'teams'}>
        Teams
      </NavLink>
      {workspace ? (
        <NavLink
          to="/workspaces/$workspace/insights"
          params={{ workspace: workspace.slug }}
          icon={<InsightsIcon />}
          selected={section === 'insights'}
        >
          Insights
        </NavLink>
      ) : null}
      {workspace && model && shown.length === 0 ? (
        <NavSection label="Teams">
          <p className={styles.none}>No teams yet</p>
        </NavSection>
      ) : null}
      {pinned.length > 0 ? <NavSection label="Pinned">{teamEntries(pinned)}</NavSection> : null}
      {others.length > 0 ? (
        <NavSection label="Teams">
          {teamEntries(others)}
          {total > SIDEBAR_TEAM_LIMIT ? <NavLink to="/">{`All teams (${total})`}</NavLink> : null}
        </NavSection>
      ) : null}
      {workspace && views.length > 0 ? (
        <NavSection label="Your views">
          {views.map((view) => (
            <NavLink
              key={view.id}
              to="/workspaces/$workspace/views/$view"
              params={{ workspace: workspace.slug, view: view.id }}
              icon={<ListFilterIcon />}
              selected={params.view === view.id}
            >
              {view.name}
            </NavLink>
          ))}
        </NavSection>
      ) : null}
      <div className={styles.footer}>
        <UserMenu user={user} />
      </div>
    </>
  )
}

/** The count props of an entry with something waiting for you: accent, announced with `label`. */
const counted = (n: number | undefined, label: string) => {
  const count = countOrUndefined(n)
  return count === undefined ? {} : { count, countTone: 'accent' as const, countLabel: label }
}

/** A team: its tile and name; the open one expands to its pages. A pinned team shows a pin. */
function TeamEntry({ workspace, team, open, section }: TeamEntry.Props) {
  const params = { workspace, team: team.slug }
  const triage = countOrUndefined(team.triage)
  const triageProps =
    triage === undefined
      ? {}
      : { count: triage, countTone: 'neutral' as const, countLabel: 'items to triage' }
  return (
    <>
      <NavLink
        to="/$workspace/$team"
        params={params}
        selected={false}
        icon={
          <Avatar
            type="team"
            aria-hidden
            slug={team.slug}
            name={team.name}
            color={team.color}
            icon={team.icon}
          />
        }
        trailing={team.pinned ? <PinIcon size={12} className={styles.pin} /> : undefined}
        {...(open ? {} : triageProps)}
      >
        {team.name}
      </NavLink>
      {open ? (
        <>
          <NavLink
            to="/$workspace/$team"
            params={params}
            sub
            icon={<HammerIcon />}
            selected={section === 'builds'}
          >
            Builds
          </NavLink>
          <NavLink
            to="/$workspace/$team/triage"
            params={params}
            sub
            icon={<ListChecksIcon />}
            selected={section === 'triage'}
            {...(triage === undefined
              ? {}
              : { count: triage, countTone: 'neutral' as const, countLabel: 'items to triage' })}
          >
            Triage
          </NavLink>
          <NavLink
            to="/$workspace/$team/baselines"
            params={params}
            sub
            icon={<ImageIcon />}
            selected={section === 'baselines'}
          >
            Baselines
          </NavLink>
          {team.siteCount > 0 ? (
            <NavLink
              to="/$workspace/$team/sites"
              params={params}
              sub
              icon={<GlobeIcon />}
              selected={section === 'sites'}
            >
              Sites
            </NavLink>
          ) : null}
        </>
      ) : null}
    </>
  )
}

namespace TeamEntry {
  export interface Props {
    workspace: string
    team: SidebarModel.Team
    open: boolean
    section: ReturnType<typeof currentSection>
  }
}

export namespace Sidebar {
  export interface Props {
    user: SessionUser
  }
}
