import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { ProjectSettingsHubPage } from '#features/project-settings/ProjectSettingsHubPage.tsx'
import { fakeApi, type ReplyHandler } from '#test/support/fetch.ts'
import { overview, sidebarModel, sidebarProject } from '#test/support/fixtures.ts'
import { renderPage } from '#test/support/render.tsx'

const API = '/api/projects/acme/web'

interface Options {
  canManage?: boolean
  webhooks?: number
  rules?: number
  regions?: number
  sites?: number
}

function api(options: Options = {}) {
  const canManage = options.canManage ?? true
  const routes: Record<string, ReplyHandler> = {
    [`GET ${API}/settings`]: {
      body: {
        canManage,
        settings: { name: 'Web App' },
        appearance: { color: 'slate', icon: null },
        workspace: { flakyBlocksMerge: true },
        webhooks: Array.from({ length: options.webhooks ?? 2 }, (_, i) => ({ id: `h${i}` })),
        webhookEvents: [],
        github: { configured: false, webhookUrl: '', link: null },
        sitesConfigured: true,
      },
    },
    'GET /api/projects': { body: { projects: [overview('acme', 'web')] } },
    'GET /api/workspaces/acme/sidebar': {
      body: sidebarModel({ projects: [sidebarProject({ siteCount: options.sites ?? 1 })] }),
    },
    [`GET ${API}/rules`]: {
      body: {
        canManage,
        rules: Array.from({ length: options.rules ?? 3 }, (_, i) => ({ id: `r${i}` })),
        rotation: { startsOn: null, members: [] },
      },
    },
    [`GET ${API}/ignore-regions`]: {
      body: {
        regions: Array.from({ length: options.regions ?? 4 }, (_, i) => ({ id: `g${i}` })),
        snapshots: [],
      },
    },
  }
  return fakeApi(routes)
}

const PAGES = [
  '/$workspace/$project/settings/general',
  '/$workspace/$project/settings/members',
  '/$workspace/$project/settings/token',
  '/$workspace/$project/settings/reviews',
  '/$workspace/$project/settings/ignore-regions',
  '/$workspace/$project/settings/webhooks',
  '/$workspace/$project/settings/sites',
]

const show = (viewport?: [number, number]) =>
  renderPage(<ProjectSettingsHubPage />, {
    route: '/$workspace/$project/settings',
    url: '/acme/web/settings',
    announcer: true,
    ...(viewport ? { viewport } : {}),
    otherRoutes: [...PAGES, '/$workspace/$project', '/workspaces/$workspace/settings/projects'],
  })

const rows = (group: string) =>
  page
    .getByRole('region', { name: group })
    .getByRole('link')
    .elements()
    .map((el) => el.querySelector('span span')?.textContent)

const rowOf = (name: string) => page.getByRole('link', { name: new RegExp(`^${name}`) })

describe('ProjectSettingsHubPage', () => {
  it('has a back link to Projects, the project name as its title and its size as the subtitle', async () => {
    api()
    await show()
    await expect.element(page.getByRole('heading', { name: 'Web App', level: 1 })).toBeVisible()
    await expect
      .element(page.getByRole('link', { name: 'Projects' }).last())
      .toHaveAttribute('href', '/workspaces/acme/settings/projects')
    await expect.element(page.getByText('3 members').first()).toBeVisible()
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect.element(crumbs.getByText('Web App')).toBeVisible()
    expect(crumbs.getByRole('link', { name: 'Web App' }).elements()).toHaveLength(0)
  })

  it('groups one row for each page: Project, Reviews and Connections', async () => {
    api()
    await show()
    await expect.element(page.getByRole('region', { name: 'Connections' })).toBeVisible()
    await expect.element(page.getByRole('region', { name: 'Reviews' })).toBeVisible()
    await expect.element(rowOf('General')).toBeVisible()
    expect(rows('Project')).toEqual(['General', 'Members', 'CI token'])
    expect(rows('Reviews')).toEqual(['Reviews and triage', 'Ignore regions'])
    expect(rows('Connections')).toEqual(['Webhooks', 'Sites'])
  })

  it('summarises what is set, from data the app already has', async () => {
    api()
    await show()
    await expect.element(rowOf('Members').getByText('3 members')).toBeVisible()
    await expect.element(rowOf('Reviews and triage').getByText('3 rules')).toBeVisible()
    await expect.element(rowOf('Ignore regions').getByText('4 regions')).toBeVisible()
    await expect.element(rowOf('Webhooks').getByText('2 webhooks')).toBeVisible()
    await expect.element(rowOf('Sites').getByText('1 site')).toBeVisible()
  })

  it('says None, or No rules, when there is nothing', async () => {
    api({ webhooks: 0, rules: 0, regions: 0, sites: 0 })
    await show()
    await expect.element(rowOf('Reviews and triage').getByText('No rules')).toBeVisible()
    await expect.element(rowOf('Ignore regions').getByText('None')).toBeVisible()
    await expect.element(rowOf('Webhooks').getByText('None')).toBeVisible()
    await expect.element(rowOf('Sites').getByText('None')).toBeVisible()
  })

  it.each([
    ['General', '/acme/web/settings/general'],
    ['Members', '/acme/web/settings/members'],
    ['CI token', '/acme/web/settings/token'],
    ['Reviews and triage', '/acme/web/settings/reviews'],
    ['Ignore regions', '/acme/web/settings/ignore-regions'],
    ['Webhooks', '/acme/web/settings/webhooks'],
    ['Sites', '/acme/web/settings/sites'],
  ])('opens %s from its row, with no page reload', async (name, path) => {
    api()
    const { router } = await show()
    const row = rowOf(name)
    await expect.element(row).toHaveAttribute('href', path)
    await row.click()
    await expect.poll(() => router.state.location.pathname).toBe(path)
  })

  it('leaves no way out to the app: no link to the project page, its builds or its sites', async () => {
    api()
    await show()
    await expect.element(rowOf('General')).toBeVisible()
    const hrefs = page
      .getByRole('link')
      .elements()
      .map((el) => el.getAttribute('href'))
    expect(hrefs).not.toContain('/acme/web')
    expect(hrefs.filter((h) => h?.startsWith('/acme/web/sites'))).toEqual([])
  })

  it('gives people who only belong to the project Members and Ignore regions', async () => {
    api({ canManage: false })
    await show()
    await expect.element(rowOf('Members')).toBeVisible()
    await expect.element(rowOf('Ignore regions')).toBeVisible()
    for (const name of ['General', 'CI token', 'Reviews and triage', 'Webhooks', 'Sites']) {
      expect(rowOf(name).elements()).toHaveLength(0)
    }
    expect(page.getByRole('region', { name: 'Connections' }).elements()).toHaveLength(0)
  })

  it('stacks on a phone with rows at least 44px tall', async () => {
    api()
    await show([390, 844])
    await expect.element(rowOf('General')).toBeVisible()
    for (const el of page.getByRole('region', { name: 'Project' }).getByRole('link').elements()) {
      expect(el.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
      expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(390)
    }
  })
})
