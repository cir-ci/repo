import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { InstanceHubPage } from '#features/instance/InstanceHubPage.tsx'
import {
  account,
  accountList,
  settingsFixture,
  workspace,
} from '#test/features/instance/fixtures.ts'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const PAGES = [
  '/instance/accounts',
  '/instance/workspaces',
  '/instance/settings',
  '/instance/health',
]

const api = () =>
  fakeApi({
    'GET /api/instance/settings': { body: settingsFixture() },
    'GET /api/instance/accounts': {
      body: accountList([account(), account({ id: 'u2', name: 'Ron' })], { total: 12 }),
    },
    'GET /api/instance/workspaces': {
      body: {
        workspaces: [
          workspace(),
          workspace({ id: 'w2', name: 'Globex', slug: 'globex' }),
          workspace({
            id: 'w3',
            name: 'Old Co',
            slug: 'old-co',
            deletedAt: '2026-11-01T00:00:00.000Z',
          }),
        ],
      },
    },
  })

const show = () =>
  renderPage(<InstanceHubPage />, {
    route: '/instance/overview',
    announcer: true,
    otherRoutes: PAGES,
  })

const rows = (group: string) =>
  page
    .getByRole('region', { name: group })
    .getByRole('link')
    .elements()
    .map((el) => el.querySelector('span span')?.textContent)

const rowOf = (name: string) => page.getByRole('link', { name: new RegExp(`^${name}`) })

describe('InstanceHubPage', () => {
  it('is named Instance, with its address as the subtitle', async () => {
    api()
    await show()
    await expect.element(page.getByRole('heading', { name: 'Instance', level: 1 })).toBeVisible()
    await expect.element(page.getByText('ci.acme.io')).toBeVisible()
  })

  it('groups one row for each page: People, Workspaces and Server', async () => {
    api()
    await show()
    await expect.element(rowOf('Accounts')).toBeVisible()
    expect(rows('People')).toEqual(['Accounts'])
    expect(rows('Workspaces')).toEqual(['All workspaces'])
    expect(rows('Server')).toEqual(['Instance settings', 'Health'])
  })

  it('summarises each page from data the app already has', async () => {
    api()
    await show()
    await expect.element(rowOf('Accounts').getByText('12 accounts')).toBeVisible()
    // The deleted workspace isn't counted.
    await expect.element(rowOf('All workspaces').getByText('2 workspaces')).toBeVisible()
    await expect.element(rowOf('Instance settings').getByText('ci.acme.io')).toBeVisible()
  })

  it('leaves Health without a summary: the doctor asks other hosts, so its checks run on its page', async () => {
    const fake = api()
    await show()
    await expect.element(rowOf('Health')).toBeVisible()
    // Its row is its name and what it is for, and no value on the right.
    expect(rowOf('Health').element().textContent).toBe(
      'HealthWhat CirCI runs on, its addresses and its background jobs',
    )
    expect(fake.calls.some((c) => c.path.startsWith('/api/instance/health'))).toBe(false)
  })

  it.each([
    ['Accounts', '/instance/accounts'],
    ['All workspaces', '/instance/workspaces'],
    ['Instance settings', '/instance/settings'],
    ['Health', '/instance/health'],
  ])('opens %s from its row', async (name, path) => {
    api()
    const { router } = await show()
    await userEvent.click(rowOf(name))
    await expect.poll(() => router.state.location.pathname).toBe(path)
  })

  it('tells someone who is not an instance admin, and shows no rows', async () => {
    fakeApi({
      'GET /api/instance/settings': { status: 403, body: { error: 'Forbidden' } },
      'GET /api/instance/accounts': { status: 403, body: { error: 'Forbidden' } },
      'GET /api/instance/workspaces': { status: 403, body: { error: 'Forbidden' } },
    })
    await show()
    await expect.element(page.getByText('Instance admins only')).toBeVisible()
    expect(page.getByRole('link', { name: /^Accounts/ }).elements()).toHaveLength(0)
    expect(page.getByRole('region', { name: 'People' }).elements()).toHaveLength(0)
  })
})
