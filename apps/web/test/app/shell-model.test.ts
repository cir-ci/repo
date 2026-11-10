import type { Team, Sidebar, View } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  countOrUndefined,
  currentSection,
  goPath,
  isOutsideFrame,
  isSettingsSection,
  listWorkspaces,
  orderTeams,
  pickWorkspace,
  pinnedViews,
  sectionLabel,
  sidebarTeams,
  TEAM_SETTINGS_PAGES,
  teamSections,
  teamSettingsKey,
  teamsTabLabel,
  switchWorkspacePath,
  yourTeams,
} from '#app/shell-model.ts'

const overview = (workspace: string, team: string): Team.Overview => ({
  workspace: { slug: workspace, name: workspace.toUpperCase(), picture: null, role: 'owner' },
  team: {
    slug: team,
    name: team,
    defaultBranch: 'main',
    color: 'slate',
    icon: null,
    memberCount: 1,
    memberPreview: [],
    youAreMember: true,
  },
  latestBuild: null,
})

describe('listWorkspaces', () => {
  it('collects the workspaces of the teams, the manageable ones and the one in the address', () => {
    const workspaces = listWorkspaces(
      [overview('beta', 'x'), overview('beta', 'y'), overview('alpha', 'z')],
      [{ slug: 'gamma', name: 'Gamma', picture: null }],
      'delta',
    )
    expect(workspaces.map((o) => o.slug)).toEqual(['alpha', 'beta', 'delta', 'gamma'])
    expect(workspaces.find((o) => o.slug === 'delta')?.name).toBe('delta')
  })

  it('carries the role in each workspace, from its teams or from the manageable list', () => {
    const member = overview('alpha', 'z')
    member.workspace.role = 'member'
    const workspaces = listWorkspaces(
      [member, overview('beta', 'x')],
      [{ slug: 'gamma', name: 'Gamma', picture: null, role: 'admin' }],
    )
    expect(workspaces.map((o) => [o.slug, o.role])).toEqual([
      ['alpha', 'member'],
      ['beta', 'owner'],
      ['gamma', 'admin'],
    ])
  })

  it('is empty before anything has loaded', () => {
    expect(listWorkspaces(undefined, undefined)).toEqual([])
  })

  it("doesn't take a reserved word in the address for a workspace", () => {
    expect(listWorkspaces(undefined, undefined, 'workspaces')).toEqual([])
  })
})

describe('pickWorkspace', () => {
  const workspaces = [
    { slug: 'a', name: 'A' },
    { slug: 'b', name: 'B' },
  ]
  it('prefers the address, then the remembered choice, then the first', () => {
    expect(pickWorkspace(workspaces, 'b', 'a')?.slug).toBe('b')
    expect(pickWorkspace(workspaces, undefined, 'b')?.slug).toBe('b')
    expect(pickWorkspace(workspaces, 'gone', 'gone')?.slug).toBe('a')
    expect(pickWorkspace([], undefined, undefined)).toBeUndefined()
  })
})

const sidebarTeam = (slug: string, over: Partial<Sidebar.Team> = {}): Sidebar.Team => ({
  slug,
  name: slug,
  color: 'slate',
  icon: null,
  pinned: false,
  triage: 0,
  memberCount: 1,
  memberPreview: [],
  siteCount: 0,
  youAreMember: true,
  ...over,
})

describe('orderTeams', () => {
  it('puts pinned teams first, in the order given, then the rest A to Z', () => {
    const ordered = orderTeams([
      sidebarTeam('zeta', { pinned: true }),
      sidebarTeam('beta'),
      sidebarTeam('alpha', { pinned: true }),
      sidebarTeam('Gamma'),
    ])
    expect(ordered.map((p) => p.slug)).toEqual(['zeta', 'alpha', 'beta', 'Gamma'])
  })
})

describe('sidebarTeams', () => {
  it('lists teams pinned first then alphabetical, capped, with the total', () => {
    const teams = ['m', 'c', 'a', 'k', 'b', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((p) =>
      sidebarTeam(p, { pinned: p === 'm' }),
    )
    const { shown, total } = sidebarTeams(teams)
    expect(shown.map((p) => p.slug)).toEqual(['m', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])
    expect(total).toBe(12)
  })

  it('keeps the open team listed even past the cap', () => {
    const teams = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'z'].map((p) => sidebarTeam(p))
    expect(sidebarTeams(teams, 10, 'z').shown.map((p) => p.slug)).toContain('z')
    expect(sidebarTeams(teams).shown.map((p) => p.slug)).not.toContain('z')
  })

  it('is empty before the sidebar has loaded', () => {
    expect(sidebarTeams(undefined)).toEqual({ shown: [], total: 0 })
  })
})

describe('countOrUndefined', () => {
  it('shows a count only when something is waiting', () => {
    expect(countOrUndefined(0)).toBeUndefined()
    expect(countOrUndefined(undefined)).toBeUndefined()
    expect(countOrUndefined(3)).toBe(3)
  })
})

const view = (id: string, pinned: boolean, position: number): View.Item => ({
  id,
  name: id,
  filters: {},
  pinned,
  position,
  team: null,
  createdAt: '2026-01-01T00:00:00.000Z',
})

describe('pinnedViews', () => {
  it("keeps the pinned views in the user's order", () => {
    const views = [view('c', true, 2), view('x', false, 0), view('a', true, 1)]
    expect(pinnedViews(views).map((v) => v.id)).toEqual(['a', 'c'])
    expect(pinnedViews(undefined)).toEqual([])
  })
})

describe('goPath', () => {
  const teams = [
    sidebarTeam('web', { triage: 0 }),
    sidebarTeam('api', { triage: 4 }),
    sidebarTeam('docs', { pinned: true }),
  ]
  it('opens the global pages', () => {
    expect(goPath('inbox', {})).toBe('/inbox')
    expect(goPath('teams', { workspace: 'acme' })).toBe('/')
  })
  it('opens workspace pages only with a workspace', () => {
    expect(goPath('reviews', { workspace: 'acme' })).toBe('/workspaces/acme/reviews')
    expect(goPath('reviews', {})).toBeUndefined()
    expect(goPath('settings', { workspace: 'acme' })).toBe('/workspaces/acme/settings')
    expect(goPath('settings', {})).toBe('/account/profile')
  })
  it("opens Members instead of General for a member who can't change the settings", () => {
    expect(goPath('settings', { workspace: 'acme', canManage: false })).toBe(
      '/workspaces/acme/settings/members',
    )
    expect(goPath('settings', { workspace: 'acme', canManage: true })).toBe(
      '/workspaces/acme/settings',
    )
  })
  it('opens triage of the open team, else the first team with work waiting, else the first', () => {
    expect(goPath('triage', { workspace: 'acme', team: 'web', teams })).toBe('/acme/web/triage')
    expect(goPath('triage', { workspace: 'acme', teams })).toBe('/acme/api/triage')
    expect(goPath('triage', { workspace: 'acme', teams: teams.slice(2) })).toBe('/acme/docs/triage')
    expect(goPath('triage', { workspace: 'acme', teams: [] })).toBeUndefined()
  })
})

const inLayout = (path: string) => isSettingsSection(currentSection(path))

describe('currentSection', () => {
  it.each([
    ['/', 'teams'],
    ['/inbox', 'inbox'],
    ['/account', 'account'],
    ['/account/appearance', 'account'],
    ['/account/shortcuts', 'account'],
    ['/instance/accounts', 'instance'],
    ['/instance', 'instance'],
    ['/workspaces/acme/reviews', 'reviews'],
    ['/workspaces/acme/insights', 'insights'],
    ['/workspaces/acme/views/v1', 'views'],
    ['/workspaces/acme/settings', 'settings'],
    ['/workspaces/acme/settings/members', 'settings'],
    ['/acme/web', 'builds'],
    ['/acme/web/builds/12', 'builds'],
    ['/acme/web/sites', 'sites'],
    ['/acme/web/triage', 'triage'],
    ['/acme/web/baselines', 'baselines'],
    ['/acme/web/settings', 'team-settings'],
    ['/acme/web/settings/reviews', 'team-settings'],
    ['/_sso/site', undefined],
    ['/acme/web/other', undefined],
  ] as const)('%s is %s', (path, section) => {
    expect(currentSection(path)).toBe(section)
  })

  it('has a label for each section', () => {
    expect(sectionLabel('triage')).toBe('Triage')
    expect(sectionLabel(undefined)).toBeUndefined()
  })

  it('gives every settings page the settings layout, and no other', () => {
    expect(inLayout('/account')).toBe(true)
    expect(inLayout('/workspaces/acme/settings/members')).toBe(true)
    expect(inLayout('/acme/web/settings')).toBe(true)
    expect(inLayout('/instance/health')).toBe(true)
    expect(inLayout('/acme/web')).toBe(false)
    expect(inLayout('/inbox')).toBe(false)
  })
})

describe('isOutsideFrame', () => {
  it('is true only for the site sign-in handoff', () => {
    expect(isOutsideFrame('/_sso/site')).toBe(true)
    expect(isOutsideFrame('/acme/web')).toBe(false)
  })
})

describe('team settings pages', () => {
  it('lists the pages in the tab order', () => {
    expect(TEAM_SETTINGS_PAGES.map((p) => p.key)).toEqual([
      'general',
      'members',
      'token',
      'reviews',
      'webhooks',
      'ignore-regions',
      'sites',
    ])
  })
  it.each([
    ['/acme/web/settings', 'general'],
    ['/acme/web/settings/members', 'members'],
    ['/acme/web/settings/token', 'token'],
    ['/acme/web/settings/reviews', 'reviews'],
    ['/acme/web/settings/webhooks', 'webhooks'],
    ['/acme/web/settings/ignore-regions', 'ignore-regions'],
    ['/acme/web/settings/ignore-regions/checkout/form', 'ignore-regions'],
    ['/acme/web/settings/sites', 'sites'],
    ['/acme/web/settings/other', undefined],
    ['/acme/web/triage', undefined],
    ['/workspaces/acme/settings', undefined],
    ['/account/appearance', undefined],
    ['/instance/settings', undefined],
  ] as const)('%s is %s', (path, key) => {
    expect(teamSettingsKey(path)).toBe(key)
  })
})

const teamOf = (ws: string) => (ws === 'globex' ? 'portal' : undefined)

const go = (path: string, to = 'globex') => switchWorkspacePath(path, to, teamOf)

describe('switchWorkspacePath', () => {
  it('keeps workspace pages and settings pages, with the new slug', () => {
    expect(go('/workspaces/acme/reviews')).toBe('/workspaces/globex/reviews')
    expect(go('/workspaces/acme/insights')).toBe('/workspaces/globex/insights')
    expect(go('/workspaces/acme/settings')).toBe('/workspaces/globex/settings')
    expect(go('/workspaces/acme/settings/members')).toBe('/workspaces/globex/settings/members')
    expect(go('/workspaces/acme/settings/integrations/github/abc')).toBe(
      '/workspaces/globex/settings/integrations',
    )
    expect(go('/workspaces/acme/views/v1')).toBe('/')
  })

  it("keeps the section of a team page, on the new workspace's team, dropping what is specific", () => {
    expect(go('/acme/web')).toBe('/globex/portal')
    expect(go('/acme/web/builds/12')).toBe('/globex/portal')
    expect(go('/acme/web/triage')).toBe('/globex/portal/triage')
    expect(go('/acme/web/baselines/home')).toBe('/globex/portal/baselines')
    expect(go('/acme/web/sites')).toBe('/globex/portal/sites')
    expect(go('/acme/web/settings')).toBe('/globex/portal/settings')
    expect(go('/acme/web/settings/token')).toBe('/globex/portal/settings/token')
  })

  it('goes to the Teams page when the new workspace has no team', () => {
    expect(go('/acme/web/triage', 'empty')).toBe('/')
  })

  it('stays put on the Teams page and the global pages', () => {
    expect(go('/')).toBe('/')
    expect(go('/inbox')).toBeUndefined()
    expect(go('/account/profile')).toBeUndefined()
    expect(go('/instance/health')).toBeUndefined()
    expect(go('/integrations/github/setup')).toBeUndefined()
  })
})

const sidebar = (pinned: string[], triage: Record<string, number> = {}): Sidebar.Model => ({
  teams: ['web', 'api', 'portal'].map((slug) => ({
    slug,
    name: slug,
    color: 'slate',
    icon: null,
    pinned: pinned.includes(slug),
    triage: triage[slug] ?? 0,
    memberCount: 1,
    memberPreview: [],
    siteCount: 0,
    youAreMember: true,
  })),
  views: [],
  inboxUnread: 0,
  reviews: 0,
  triageAssigned: 0,
  canManage: true,
})

describe('yourTeams, teamSections and teamsTabLabel', () => {
  const items = [overview('globex', 'portal'), overview('acme', 'web'), overview('acme', 'api')]

  it('puts pinned teams first, then the rest A to Z, with the sidebar counts', () => {
    const teams = yourTeams(items, {
      acme: sidebar(['web'], { web: 4 }),
      globex: sidebar([]),
    })
    expect(teams.map((t) => [t.slug, t.pinned, t.triage])).toEqual([
      ['web', true, 4],
      ['api', false, 0],
      ['portal', false, 0],
    ])
  })

  it('lists the teams before any sidebar model has loaded', () => {
    expect(yourTeams(items, {}).map((t) => t.slug)).toEqual(['api', 'portal', 'web'])
    expect(yourTeams(undefined, {})).toEqual([])
  })

  it('is one run for one workspace, and Pinned plus one run per workspace for several', () => {
    const several = yourTeams(items, { acme: sidebar(['web']), globex: sidebar([]) })
    expect(
      teamSections(several).map((s) => [s.label, s.showWorkspace, s.teams.map((t) => t.slug)]),
    ).toEqual([
      ['Pinned', true, ['web']],
      ['ACME', false, ['api']],
      ['GLOBEX', false, ['portal']],
    ])
    const one = yourTeams([overview('acme', 'web'), overview('acme', 'api')], {})
    expect(teamSections(one).map((s) => [s.label, s.teams.map((t) => t.slug)])).toEqual([
      [undefined, ['api', 'web']],
    ])
    expect(teamSections([])).toEqual([])
  })

  it('labels the tab with the team when there is exactly one, else Teams', () => {
    expect(teamsTabLabel(yourTeams([overview('acme', 'web')], {}))).toBe('web')
    expect(teamsTabLabel(yourTeams(items, {}))).toBe('Teams')
    expect(teamsTabLabel([])).toBe('Teams')
  })
})
