import type { Project } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  currentSection,
  isOutsideFrame,
  listOrgs,
  pickOrg,
  sectionLabel,
  sidebarProjects,
} from '../../src/app/shell-model.ts'

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

describe('sidebarProjects', () => {
  it('lists one organization’s projects alphabetically, capped, with the total', () => {
    const projects = [
      ...['m', 'c', 'a', 'k', 'b', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((p) =>
        overview('acme', p),
      ),
      overview('other', 'zzz'),
    ]
    const { shown, total } = sidebarProjects(projects, 'acme')
    expect(shown.map((p) => p.slug)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'])
    expect(total).toBe(12)
  })

  it('keeps the open project listed even past the cap', () => {
    const projects = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'z'].map((p) =>
      overview('acme', p),
    )
    expect(sidebarProjects(projects, 'acme', 10, 'z').shown.map((p) => p.slug)).toContain('z')
    expect(sidebarProjects(projects, 'acme').shown.map((p) => p.slug)).not.toContain('z')
  })

  it('is empty for no organization', () => {
    expect(sidebarProjects([overview('acme', 'a')], undefined)).toEqual({ shown: [], total: 0 })
  })
})

describe('currentSection', () => {
  it.each([
    ['/', 'projects'],
    ['/account', 'account'],
    ['/organizations/acme/members', 'members'],
    ['/acme/web', 'builds'],
    ['/acme/web/builds/12', 'builds'],
    ['/acme/web/sites', 'sites'],
    ['/acme/web/settings', 'settings'],
    ['/_sso/site', undefined],
    ['/acme/web/other', undefined],
  ] as const)('%s is %s', (path, section) => {
    expect(currentSection(path)).toBe(section)
  })

  it('has a label for each section', () => {
    expect(sectionLabel('members')).toBe('Members')
    expect(sectionLabel(undefined)).toBeUndefined()
  })
})

describe('isOutsideFrame', () => {
  it('is true only for the site sign-in handoff', () => {
    expect(isOutsideFrame('/_sso/site')).toBe(true)
    expect(isOutsideFrame('/acme/web')).toBe(false)
  })
})
