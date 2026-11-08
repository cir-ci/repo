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

import { NavLink } from './NavLink.tsx'
import { OrgSwitcher } from './OrgSwitcher.tsx'
import {
  countOrUndefined,
  currentSection,
  type OrgRef,
  pinnedViews,
  readRememberedOrg,
  rememberOrg,
  SIDEBAR_PROJECT_LIMIT,
  sidebarProjects,
} from './shell-model.ts'
import { useShortcutLayer } from './ShortcutLayer.tsx'
import { useOrgs } from './use-orgs.ts'

import styles from './Sidebar.module.css'

/**
 * Top to bottom (docs/linear-features-plan.md): the organization switcher, Search, Inbox, Reviews,
 * Projects, Insights, Settings, "Your views", the organization's projects (the open one expands to
 * its pages) and the signed-in person. `AppFrame` wraps this in the Main navigation on wide
 * screens; the `Drawer` does on narrow ones.
 */
export function Sidebar({ user }: Sidebar.Props) {
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const section = currentSection(pathname)
  const { openCommandMenu } = useShortcutLayer()
  const [chosen, setChosen] = useState(readRememberedOrg)
  const { orgs, org } = useOrgs(chosen)
  const { data: model } = useSidebarModel(org?.slug)
  const { shown, total } = sidebarProjects(model?.projects, SIDEBAR_PROJECT_LIMIT, params.project)
  const views = pinnedViews(model?.views)

  function switchOrg(next: OrgRef) {
    rememberOrg(next.slug)
    setChosen(next.slug)
    void navigate({ to: '/' })
  }

  return (
    <>
      <OrgSwitcher orgs={orgs} current={org} onSelect={switchOrg} />
      <NavItem icon={<SearchIcon />} trailing={<Kbd>⌘K</Kbd>} onClick={openCommandMenu}>
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
      {org ? (
        <NavLink
          to="/organizations/$org/reviews"
          params={{ org: org.slug }}
          icon={<ReviewIcon />}
          selected={section === 'reviews'}
          {...counted(model?.reviews, 'waiting')}
        >
          Reviews
        </NavLink>
      ) : null}
      <NavLink to="/" icon={<FolderOpenIcon />} selected={section === 'projects'}>
        Projects
      </NavLink>
      {org ? (
        <NavLink
          to="/organizations/$org/insights"
          params={{ org: org.slug }}
          icon={<InsightsIcon />}
          selected={section === 'insights'}
        >
          Insights
        </NavLink>
      ) : null}
      {org ? (
        <NavLink
          to="/organizations/$org/settings"
          params={{ org: org.slug }}
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
      {org && views.length > 0 ? (
        <NavSection label="Your views">
          {views.map((view) => (
            <NavLink
              key={view.id}
              to="/organizations/$org/views/$view"
              params={{ org: org.slug, view: view.id }}
              selected={params.view === view.id}
            >
              {view.name}
            </NavLink>
          ))}
        </NavSection>
      ) : null}
      {org && shown.length > 0 ? (
        <NavSection label="Projects">
          {shown.map((project) => (
            <ProjectEntry
              key={project.slug}
              org={org.slug}
              project={project}
              open={params.project === project.slug && params.org === org.slug}
              section={section}
            />
          ))}
          {total > SIDEBAR_PROJECT_LIMIT ? (
            <NavLink to="/">{`All projects (${total})`}</NavLink>
          ) : null}
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

function ProjectEntry({ org, project, open, section }: ProjectEntry.Props) {
  const params = { org, project: project.slug }
  const triage = countOrUndefined(project.triage)
  return (
    <>
      <NavLink to="/$org/$project" params={params} selected={false}>
        {project.name}
      </NavLink>
      {open ? (
        <>
          <NavLink to="/$org/$project" params={params} sub selected={section === 'builds'}>
            Builds
          </NavLink>
          <NavLink
            to="/$org/$project/triage"
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
            to="/$org/$project/baselines"
            params={params}
            sub
            selected={section === 'baselines'}
          >
            Baselines
          </NavLink>
          <NavLink
            to="/$org/$project/settings"
            params={params}
            sub
            selected={section === 'project-settings'}
          >
            Settings
          </NavLink>
        </>
      ) : null}
    </>
  )
}

namespace ProjectEntry {
  export interface Props {
    org: string
    project: { slug: string; name: string; triage: number }
    open: boolean
    section: ReturnType<typeof currentSection>
  }
}

export namespace Sidebar {
  export interface Props {
    user: SessionUser
  }
}
