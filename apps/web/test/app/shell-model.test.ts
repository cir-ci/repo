import type { Team, Sidebar, View } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  countOrUndefined,
  currentSection,
  goPath,
  isOutsideFrame,
  isSettingsSection,
  listWorkspaces,
  matchTeams,
  orderTeams,
  pickSettingsTeam,
  pickWorkspace,
  pinnedViews,
  sectionLabel,
  settingsTeams,
  sidebarTeams,
  TEAM_SETTINGS_PAGES,
  teamSettingsKey,
  teamSettingsPath,
  workspaceLetter,
  workspaceMark,
} from '#app/shell-model.ts'

const overview = (workspace: string, team: string): Team.Overview => ({
  workspace: { slug: workspace, name: workspace.toUpperCase(), picture: null },
  team: { slug: team, name: team, defaultBranch: 'main', color: 'slate', icon: null },
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

  it('is empty before anything has loaded', () => {
    expect(listWorkspaces(undefined, undefined)).toEqual([])
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
  it('keeps the pinned views in the user’s order', () => {
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

describe('workspace marks', () => {
  it('makes the open workspace brand maroon and the others neutral', () => {
    expect(workspaceMark('acme', 'acme')).toBe('brand')
    expect(workspaceMark('acme-labs', 'acme')).toBe('neutral')
    expect(workspaceMark('acme', undefined)).toBe('neutral')
  })
  it('uses the first letter, lower case', () => {
    expect(workspaceLetter('Acme')).toBe('a')
    expect(workspaceLetter('  side-project')).toBe('s')
    expect(workspaceLetter('')).toBe('?')
  })
})

describe('team settings pages', () => {
  it('lists the five pages in the nav order', () => {
    expect(TEAM_SETTINGS_PAGES.map((p) => p.key)).toEqual([
      'general',
      'token',
      'reviews',
      'webhooks',
      'ignore-regions',
    ])
  })
  it.each([
    ['/acme/web/settings', 'general'],
    ['/acme/web/settings/token', 'token'],
    ['/acme/web/settings/reviews', 'reviews'],
    ['/acme/web/settings/webhooks', 'webhooks'],
    ['/acme/web/settings/ignore-regions', 'ignore-regions'],
    ['/acme/web/settings/other', undefined],
    ['/acme/web/triage', undefined],
    ['/workspaces/acme/settings', undefined],
    ['/account/appearance', undefined],
    ['/instance/settings', undefined],
  ] as const)('%s is %s', (path, key) => {
    expect(teamSettingsKey(path)).toBe(key)
  })
  it('switches team on the same settings page, General elsewhere', () => {
    expect(teamSettingsPath('acme', 'api', '/acme/web/settings/webhooks')).toBe(
      '/acme/api/settings/webhooks',
    )
    expect(teamSettingsPath('acme', 'api', '/acme/web/settings')).toBe('/acme/api/settings')
    expect(teamSettingsPath('acme', 'api', '/account/profile')).toBe('/acme/api/settings')
    expect(teamSettingsPath('acme', 'a b', '/inbox')).toBe('/acme/a%20b/settings')
  })
  it('finds teams by what is typed, ignoring case', () => {
    const teams = [{ name: 'web-app' }, { name: 'Storybook' }, { name: 'api' }]
    expect(matchTeams(teams, 'STORY')).toEqual([{ name: 'Storybook' }])
    expect(matchTeams(teams, '  ')).toHaveLength(3)
    expect(matchTeams(teams, 'zzz')).toEqual([])
  })
  it('is about the team in the address, else the last used, else the first', () => {
    const teams = [{ slug: 'api' }, { slug: 'web' }]
    expect(pickSettingsTeam(teams, 'web', 'api')?.slug).toBe('web')
    expect(pickSettingsTeam(teams, undefined, 'web')?.slug).toBe('web')
    expect(pickSettingsTeam(teams, 'gone', 'gone')?.slug).toBe('api')
    expect(pickSettingsTeam([], 'web', 'web')).toBeUndefined()
  })
})

describe('settingsTeams', () => {
  const teams = [{ slug: 'qa-team' }, { slug: 'web' }]

  it('keeps the sidebar teams the teams list knows in that workspace', () => {
    const known = [overview('acme', 'web'), overview('other', 'qa-team')]
    expect(settingsTeams(teams, known, 'acme')).toEqual([{ slug: 'web' }])
  })

  it('trusts the sidebar when the teams list knows nothing of the workspace', () => {
    expect(settingsTeams(teams, [overview('other', 'qa')], 'acme')).toEqual(teams)
    expect(settingsTeams(teams, undefined, 'acme')).toEqual(teams)
  })
})
