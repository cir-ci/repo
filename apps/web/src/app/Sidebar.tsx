import { FolderOpenIcon, Text, UsersIcon } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router'
import { useState } from 'react'

import { UserMenu } from '../features/auth/UserMenu.tsx'
import { capabilitiesQuery, projectsQuery } from '../features/projects/api.ts'
import type { SessionUser } from '../lib/auth-client.ts'
import { NavLink } from './NavLink.tsx'
import { OrgSwitcher } from './OrgSwitcher.tsx'
import {
  currentSection,
  listOrgs,
  type OrgRef,
  pickOrg,
  readRememberedOrg,
  rememberOrg,
  SIDEBAR_PROJECT_LIMIT,
  sidebarProjects,
} from './shell-model.ts'

import styles from './Sidebar.module.css'

/**
 * Provisional (docs/design-gaps.md §6), top to bottom: the organization switcher, the main pages,
 * the organization's projects (the open one expands to its pages), and the signed-in person.
 * `AppFrame` wraps this in the Main navigation on wide screens; the `Drawer` does on narrow ones.
 */
export function Sidebar({ user }: Sidebar.Props) {
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const section = currentSection(pathname)
  const { data: overview } = useQuery(projectsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const [chosen, setChosen] = useState(readRememberedOrg)

  const orgs = listOrgs(overview?.projects, caps?.manageableOrganizations, params.org)
  const org = pickOrg(orgs, params.org, chosen)
  const { shown, total } = sidebarProjects(overview?.projects, org?.slug, undefined, params.project)

  function switchOrg(next: OrgRef) {
    rememberOrg(next.slug)
    setChosen(next.slug)
    void navigate({ to: '/' })
  }

  return (
    <>
      <OrgSwitcher orgs={orgs} current={org} onSelect={switchOrg} />
      <NavLink to="/" icon={<FolderOpenIcon />} selected={section === 'projects'}>
        Projects
      </NavLink>
      {org ? (
        <NavLink
          to="/organizations/$org/members"
          params={{ org: org.slug }}
          icon={<UsersIcon />}
          selected={section === 'members'}
        >
          Members
        </NavLink>
      ) : null}
      {org && shown.length > 0 ? (
        <>
          <Text variant="micro" tone="tertiary" className={styles['groupLabel']}>
            Projects
          </Text>
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
        </>
      ) : null}
      <div className={styles['footer']}>
        <UserMenu user={user} />
      </div>
    </>
  )
}

function ProjectEntry({ org, project, open, section }: ProjectEntry.Props) {
  return (
    <>
      <NavLink
        to="/$org/$project"
        params={{ org, project: project.slug }}
        selected={open && section === 'builds'}
      >
        {project.name}
      </NavLink>
      {open ? (
        <div className={styles['nested']}>
          <NavLink
            to="/$org/$project/sites"
            params={{ org, project: project.slug }}
            selected={section === 'sites'}
          >
            Sites
          </NavLink>
          <NavLink
            to="/$org/$project/settings"
            params={{ org, project: project.slug }}
            selected={section === 'settings'}
          >
            Settings
          </NavLink>
        </div>
      ) : null}
    </>
  )
}

namespace ProjectEntry {
  export interface Props {
    org: string
    project: { slug: string; name: string }
    open: boolean
    section: ReturnType<typeof currentSection>
  }
}

export namespace Sidebar {
  export interface Props {
    user: SessionUser
  }
}
