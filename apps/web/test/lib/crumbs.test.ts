import { describe, expect, it } from 'vitest'

import { crumbsFor, teamCrumb, teamSettingsCrumb, workspaceCrumb } from '#lib/crumbs.ts'

const acme = { slug: 'acme', name: 'Acme' }
const web = { slug: 'web-app', name: 'Web app' }

describe('breadcrumb rule', () => {
  it('shows display names, never slugs, and links the workspace to the Inbox', () => {
    expect(workspaceCrumb(acme)).toEqual({
      label: 'Acme',
      link: { to: '/inbox' },
      tooltip: 'Go to Inbox',
    })
  })

  it('links the team to its Builds page, not its settings', () => {
    expect(teamCrumb('acme', web)).toEqual({
      label: 'Web app',
      link: { to: '/$workspace/$team', params: { workspace: 'acme', team: 'web-app' } },
      tooltip: 'Go to Builds',
    })
  })

  it('starts a workspace-level page with the workspace crumb', () => {
    expect(crumbsFor({ workspace: acme }).map((c) => c.label)).toEqual(['Acme'])
  })

  it('starts a team-level page with the workspace and team crumbs, then the page’s own', () => {
    const crumbs = crumbsFor({ workspace: acme, team: web }, [teamSettingsCrumb('acme', 'web-app')])
    expect(crumbs.map((c) => c.label)).toEqual(['Acme', 'Web app', 'Settings'])
    expect(crumbs.map((c) => c.link?.to)).toEqual([
      '/inbox',
      '/$workspace/$team',
      '/$workspace/$team/settings',
    ])
    expect(crumbs.every((c) => c.tooltip?.startsWith('Go to '))).toBe(true)
  })
})
