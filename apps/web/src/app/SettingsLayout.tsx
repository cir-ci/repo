import { NavSection } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { capabilitiesQuery, projectsQuery } from '../features/projects/api.ts'
import { NavLink } from './NavLink.tsx'
import { listOrgs, pickOrg, readRememberedOrg } from './shell-model.ts'

import styles from './SettingsLayout.module.css'

/**
 * The frame of every settings page: one nav with three sections (Account, Organisation, Project)
 * beside the page. The organisation is the one in the address, else the last chosen; the Project
 * section shows only on a project's pages.
 */
export function SettingsLayout({ children }: SettingsLayout.Props) {
  const params = useParams({ strict: false })
  const { data: overview } = useQuery(projectsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const orgs = listOrgs(overview?.projects, caps?.manageableOrganizations, params.org)
  const org = pickOrg(orgs, params.org, readRememberedOrg())
  const project = params.project

  return (
    <div className={styles['root']}>
      <nav aria-label="Settings" className={styles['nav']}>
        <NavSection label="Account">
          <NavLink to="/account">Profile</NavLink>
          <NavLink to="/account/notifications">Notifications</NavLink>
          <NavLink to="/account/appearance">Appearance</NavLink>
        </NavSection>
        {org ? (
          <NavSection label={`Organisation · ${org.name}`}>
            <NavLink to="/organizations/$org/settings" params={{ org: org.slug }}>
              General
            </NavLink>
            <NavLink to="/organizations/$org/settings/members" params={{ org: org.slug }}>
              Members
            </NavLink>
            <NavLink to="/organizations/$org/settings/integrations" params={{ org: org.slug }}>
              Integrations
            </NavLink>
            <NavLink to="/organizations/$org/settings/storage" params={{ org: org.slug }}>
              Storage
            </NavLink>
          </NavSection>
        ) : null}
        {org && project ? (
          <NavSection label={`Project · ${project}`}>
            <NavLink to="/$org/$project/settings/reviews" params={{ org: org.slug, project }}>
              Reviews and triage
            </NavLink>
            <NavLink to="/$org/$project/settings" params={{ org: org.slug, project }}>
              General
            </NavLink>
          </NavSection>
        ) : null}
      </nav>
      <div className={styles['page']}>{children}</div>
    </div>
  )
}

export namespace SettingsLayout {
  export interface Props {
    children: ReactNode
  }
}
