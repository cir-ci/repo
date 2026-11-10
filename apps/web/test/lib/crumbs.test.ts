import { describe, expect, it } from 'vitest'

import {
  crumbsFor,
  teamCrumb,
  teamsSettingsCrumb,
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

  it('links the team to its Builds page, not its settings', () => {
    expect(teamCrumb('acme', web)).toEqual({
      label: 'Web app',
      link: { to: '/$workspace/$team', params: { workspace: 'acme', team: 'web-app' } },
      tooltip: 'Team: opens its Builds page',
    })
  })

  it('starts a workspace-level page with the workspace crumb', () => {
    expect(crumbsFor({ workspace: acme }).map((c) => c.label)).toEqual(['Acme'])
  })

  it("starts a team's settings with the workspace, its Settings and Teams, then the team", () => {
    const crumbs = crumbsFor({ workspace: acme }, [
      workspaceSettingsCrumb('acme'),
      teamsSettingsCrumb('acme'),
    ])
    expect(crumbs.map((c) => c.label)).toEqual(['Acme', 'Settings', 'Teams'])
    expect(crumbs.map((c) => c.link?.to)).toEqual([
      '/inbox',
      '/workspaces/$workspace/settings',
      '/workspaces/$workspace/settings/teams',
    ])
  })

  it('starts a team-level page with the workspace and team crumbs', () => {
    const crumbs = crumbsFor({ workspace: acme, team: web })
    expect(crumbs.map((c) => c.label)).toEqual(['Acme', 'Web app'])
    expect(crumbs.map((c) => c.tooltip)).toEqual([
      'Workspace: opens the Inbox',
      'Team: opens its Builds page',
    ])
  })
})
