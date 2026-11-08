import type { Project, Sidebar, View } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  countOrUndefined,
  currentSection,
  goPath,
  isOutsideFrame,
  isSettingsSection,
  listOrgs,
  orderProjects,
  pickOrg,
  pinnedViews,
  sectionLabel,
  sidebarProjects,
} from '#app/shell-model.ts'

const overview = (org: string, project: string): Project.Overview => ({
  org: { slug: org, name: org.toUpperCase() },
  project: { slug: project, name: project, defaultBranch: 'main' },
  latestBuild: null,
})

describe('listOrgs', () => {
  it('collects the organizations of the projects, the manageable ones and the one in the address', () => {
    const orgs = listOrgs(
      [overview('beta', 'x'), overview('beta', 'y'), overview('alpha', 'z')],
      [{ slug: 'gamma', name: 'Gamma' }],
      'delta',
    )
    expect(orgs.map((o) => o.slug)).toEqual(['alpha', 'beta', 'delta', 'gamma'])
    expect(orgs.find((o) => o.slug === 'delta')?.name).toBe('delta')
  })

  it('is empty before anything has loaded', () => {
    expect(listOrgs(undefined, undefined)).toEqual([])
  })
})

describe('pickOrg', () => {
  const orgs = [
    { slug: 'a', name: 'A' },
    { slug: 'b', name: 'B' },
  ]
  it('prefers the address, then the remembered choice, then the first', () => {
    expect(pickOrg(orgs, 'b', 'a')?.slug).toBe('b')
    expect(pickOrg(orgs, undefined, 'b')?.slug).toBe('b')
    expect(pickOrg(orgs, 'gone', 'gone')?.slug).toBe('a')
    expect(pickOrg([], undefined, undefined)).toBeUndefined()
  })
})

const sidebarProject = (slug: string, over: Partial<Sidebar.Project> = {}): Sidebar.Project => ({
  slug,
  name: slug,
  pinned: false,
  triage: 0,
  ...over,
})

describe('orderProjects', () => {
  it('puts pinned projects first, in the order given, then the rest A to Z', () => {
    const ordered = orderProjects([
      sidebarProject('zeta', { pinned: true }),
      sidebarProject('beta'),
      sidebarProject('alpha', { pinned: true }),
      sidebarProject('Gamma'),
    ])
    expect(ordered.map((p) => p.slug)).toEqual(['zeta', 'alpha', 'beta', 'Gamma'])
  })
})

describe('sidebarProjects', () => {
  it('lists projects pinned first then alphabetical, capped, with the total', () => {
    const projects = ['m', 'c', 'a', 'k', 'b', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((p) =>
      sidebarProject(p, { pinned: p === 'm' }),
    )
    const { shown, total } = sidebarProjects(projects)
    expect(shown.map((p) => p.slug)).toEqual(['m', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])
    expect(total).toBe(12)
  })

  it('keeps the open project listed even past the cap', () => {
    const projects = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'z'].map((p) =>
      sidebarProject(p),
    )
    expect(sidebarProjects(projects, 10, 'z').shown.map((p) => p.slug)).toContain('z')
    expect(sidebarProjects(projects).shown.map((p) => p.slug)).not.toContain('z')
  })

  it('is empty before the sidebar has loaded', () => {
    expect(sidebarProjects(undefined)).toEqual({ shown: [], total: 0 })
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
  project: null,
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
  const projects = [
    sidebarProject('web', { triage: 0 }),
    sidebarProject('api', { triage: 4 }),
    sidebarProject('docs', { pinned: true }),
  ]
  it('opens the global pages', () => {
    expect(goPath('inbox', {})).toBe('/inbox')
    expect(goPath('projects', { org: 'acme' })).toBe('/')
  })
  it('opens organization pages only with an organization', () => {
    expect(goPath('reviews', { org: 'acme' })).toBe('/organizations/acme/reviews')
    expect(goPath('reviews', {})).toBeUndefined()
    expect(goPath('settings', { org: 'acme' })).toBe('/organizations/acme/settings')
    expect(goPath('settings', {})).toBe('/account')
  })
  it('opens triage of the open project, else the first project with work waiting, else the first', () => {
    expect(goPath('triage', { org: 'acme', project: 'web', projects })).toBe('/acme/web/triage')
    expect(goPath('triage', { org: 'acme', projects })).toBe('/acme/api/triage')
    expect(goPath('triage', { org: 'acme', projects: projects.slice(2) })).toBe('/acme/docs/triage')
    expect(goPath('triage', { org: 'acme', projects: [] })).toBeUndefined()
  })
})

const inLayout = (path: string) => isSettingsSection(currentSection(path))

describe('currentSection', () => {
  it.each([
    ['/', 'projects'],
    ['/inbox', 'inbox'],
    ['/account', 'account'],
    ['/account/appearance', 'account'],
    ['/organizations/acme/reviews', 'reviews'],
    ['/organizations/acme/insights', 'insights'],
    ['/organizations/acme/views/v1', 'views'],
    ['/organizations/acme/settings', 'settings'],
    ['/organizations/acme/settings/members', 'settings'],
    ['/acme/web', 'builds'],
    ['/acme/web/builds/12', 'builds'],
    ['/acme/web/sites', 'sites'],
    ['/acme/web/triage', 'triage'],
    ['/acme/web/baselines', 'baselines'],
    ['/acme/web/settings', 'project-settings'],
    ['/acme/web/settings/reviews', 'project-settings'],
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
    expect(inLayout('/organizations/acme/settings/members')).toBe(true)
    expect(inLayout('/acme/web/settings')).toBe(true)
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
