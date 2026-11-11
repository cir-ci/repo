import { describe, expect, it } from 'vitest'

import {
  crumbsFor,
  projectCrumb,
  projectsSettingsCrumb,
  workspaceCrumb,
  workspaceSettingsCrumb,
} from '#lib/crumbs.ts'

const acme = { slug: 'acme', name: 'Acme' }
const web = { slug: 'web-app', name: 'Web app' }

describe('breadcrumb rule', () => {
  it('shows display names, never slugs, and links the workspace to the Inbox', () => {
    expect(workspaceCrumb(acme)).toEqual({
      label: 'Acme',
      link: { to: '/inbox' },
      tooltip: 'Workspace: opens the Inbox',
    })
  })

  it('links the project to its Builds page, not its settings', () => {
    expect(projectCrumb('acme', web)).toEqual({
      label: 'Web app',
      link: { to: '/$workspace/$project', params: { workspace: 'acme', project: 'web-app' } },
      tooltip: 'Project: opens its Builds page',
    })
  })

  it('starts a workspace-level page with the workspace crumb', () => {
    expect(crumbsFor({ workspace: acme }).map((c) => c.label)).toEqual(['Acme'])
  })

  it("starts a project's settings with the workspace, its Settings and Projects, then the project", () => {
    const crumbs = crumbsFor({ workspace: acme }, [
      workspaceSettingsCrumb('acme'),
      projectsSettingsCrumb('acme'),
    ])
    expect(crumbs.map((c) => c.label)).toEqual(['Acme', 'Settings', 'Projects'])
    expect(crumbs.map((c) => c.link?.to)).toEqual([
      '/inbox',
      '/workspaces/$workspace/settings',
      '/workspaces/$workspace/settings/projects',
    ])
  })

  it('starts a project-level page with the workspace and project crumbs', () => {
    const crumbs = crumbsFor({ workspace: acme, project: web })
    expect(crumbs.map((c) => c.label)).toEqual(['Acme', 'Web app'])
    expect(crumbs.map((c) => c.tooltip)).toEqual([
      'Workspace: opens the Inbox',
      'Project: opens its Builds page',
    ])
  })
})
