import {
  FolderOpenIcon,
  InboxIcon,
  InsightsIcon,
  Kbd,
  NavItem,
  NavSection,
  ReviewIcon,
  SearchIcon,
  SettingsIcon,
} from '@circi/ui'
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router'
import { useState } from 'react'

import { UserMenu } from '#features/auth/UserMenu.tsx'
import { useSidebarModel } from '#features/sidebar/api.ts'
import type { SessionUser } from '#lib/auth-client.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'

import { NavLink } from './NavLink.tsx'
import {
  countOrUndefined,
  currentSection,
  type WorkspaceRef,
  pinnedViews,
  readRememberedWorkspace,
  rememberWorkspace,
  SIDEBAR_TEAM_LIMIT,
  sidebarTeams,
} from './shell-model.ts'
import { useWorkspaces } from './use-workspaces.ts'
import { WorkspaceSwitcher } from './WorkspaceSwitcher.tsx'

import styles from './Sidebar.module.css'

/**
 * Top to bottom (docs/linear-features-plan.md): the workspace switcher, Search, Inbox, Reviews,
 * Teams, Insights, Settings, "Your views", the workspace's teams (the open one expands to
 * its pages) and the signed-in person. `AppFrame` wraps this in the Main navigation on wide
 * screens; the `Drawer` does on narrow ones.
 */
export function Sidebar({ user }: Sidebar.Props) {
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const section = currentSection(pathname)
  const setCommandMenuOpen = useOverlayStore((s) => s.setCommandMenuOpen)
  const [chosen, setChosen] = useState(readRememberedWorkspace)
  const { workspaces, workspace } = useWorkspaces(chosen)
  const { data: model } = useSidebarModel(workspace?.slug)
  const { shown, total } = sidebarTeams(model?.teams, SIDEBAR_TEAM_LIMIT, params.team)
  const views = pinnedViews(model?.views)

  function switchWorkspace(next: WorkspaceRef) {
    rememberWorkspace(next.slug)
    setChosen(next.slug)
    void navigate({ to: '/' })
  }

  return (
    <>
      <WorkspaceSwitcher workspaces={workspaces} current={workspace} onSelect={switchWorkspace} />
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
        {...counted(model?.inboxUnread, 'unread')}
      >
        Inbox
      </NavLink>
      {workspace ? (
        <NavLink
          to="/workspaces/$workspace/reviews"
          params={{ workspace: workspace.slug }}
          icon={<ReviewIcon />}
          selected={section === 'reviews'}
          {...counted(model?.reviews, 'waiting')}
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
      {workspace ? (
        <NavLink
          to="/workspaces/$workspace/settings"
          params={{ workspace: workspace.slug }}
          icon={<SettingsIcon />}
          selected={section === 'settings' || section === 'account'}
        >
          Settings
        </NavLink>
      ) : (
        <NavLink to="/account" icon={<SettingsIcon />} selected={section === 'account'}>
          Settings
        </NavLink>
      )}
      {workspace && views.length > 0 ? (
        <NavSection label="Your views">
          {views.map((view) => (
            <NavLink
              key={view.id}
              to="/workspaces/$workspace/views/$view"
              params={{ workspace: workspace.slug, view: view.id }}
              selected={params.view === view.id}
            >
              {view.name}
            </NavLink>
          ))}
        </NavSection>
      ) : null}
      {workspace && shown.length > 0 ? (
        <NavSection label="Teams">
          {shown.map((team) => (
            <TeamEntry
              key={team.slug}
              workspace={workspace.slug}
              team={team}
              open={params.team === team.slug && params.workspace === workspace.slug}
              section={section}
            />
          ))}
          {total > SIDEBAR_TEAM_LIMIT ? <NavLink to="/">{`All teams (${total})`}</NavLink> : null}
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

function TeamEntry({ workspace, team, open, section }: TeamEntry.Props) {
  const params = { workspace, team: team.slug }
  const triage = countOrUndefined(team.triage)
  return (
    <>
      <NavLink to="/$workspace/$team" params={params} selected={false}>
        {team.name}
      </NavLink>
      {open ? (
        <>
          <NavLink to="/$workspace/$team" params={params} sub selected={section === 'builds'}>
            Builds
          </NavLink>
          <NavLink
            to="/$workspace/$team/triage"
            params={params}
            sub
            selected={section === 'triage'}
            {...(triage === undefined
              ? {}
              : { count: triage, countTone: 'neutral' as const, countLabel: 'waiting' })}
          >
            Triage
          </NavLink>
          <NavLink
            to="/$workspace/$team/baselines"
            params={params}
            sub
            selected={section === 'baselines'}
          >
            Baselines
          </NavLink>
          <NavLink
            to="/$workspace/$team/settings"
            params={params}
            sub
            selected={section === 'team-settings'}
          >
            Settings
          </NavLink>
        </>
      ) : null}
    </>
  )
}

namespace TeamEntry {
  export interface Props {
    workspace: string
    team: { slug: string; name: string; triage: number }
    open: boolean
    section: ReturnType<typeof currentSection>
  }
}

export namespace Sidebar {
  export interface Props {
    user: SessionUser
  }
}
