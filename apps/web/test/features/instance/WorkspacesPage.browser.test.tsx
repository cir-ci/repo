import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { findWorkspaces } from '#features/instance/workspaces-list.ts'
import { WorkspacesPage } from '#features/instance/WorkspacesPage.tsx'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { pageHeader } from '#test/support/header.ts'
import { renderPage } from '#test/support/render.tsx'

import { workspace } from './fixtures.ts'

const workspaces = [
  workspace(),
  workspace({ id: 'w2', name: 'Globex', slug: 'globex', memberCount: 1, projectCount: 1 }),
  workspace({
    id: 'w3',
    name: 'Old Co',
    slug: 'old-co',
    deletedAt: '2026-11-01T00:00:00.000Z',
    daysLeft: 22,
  }),
]

const show = (list = workspaces) =>
  renderPage(<WorkspacesPage />, {
    route: '/instance/workspaces',
    otherRoutes: ['/workspaces/$workspace/settings'],
    api: { 'GET /api/instance/workspaces': { body: { workspaces: list } } },
  })

describe('findWorkspaces', () => {
  it('matches the name or the slug, case aside', () => {
    expect(findWorkspaces(workspaces, 'GLOBE').map((w) => w.slug)).toEqual(['globex'])
    expect(findWorkspaces(workspaces, 'old-co').map((w) => w.slug)).toEqual(['old-co'])
    expect(findWorkspaces(workspaces, ' ')).toHaveLength(3)
  })
})

describe('Settings, Workspaces', () => {
  it('lists every workspace with its slug, size and storage', async () => {
    await show()
    const list = page.getByRole('list', { name: 'Workspaces', exact: true })
    await expect.element(list.getByText('Globex', { exact: true })).toBeVisible()
    expect(list.getByRole('listitem').elements()).toHaveLength(2)
    await expect.element(list.getByText('acme', { exact: true })).toBeVisible()
    await expect.element(list.getByText('6 members · 3 projects')).toBeVisible()
    await expect.element(list.getByText('1 member · 1 project')).toBeVisible()
    await expect.element(list.getByText('1.5 MB').first()).toBeVisible()
  })

  it('shows the deleted workspaces as a group, with the days left', async () => {
    await show()
    const deleted = page.getByRole('list', { name: 'Deleted workspaces' })
    await expect.element(deleted.getByText('Old Co', { exact: true })).toBeVisible()
    await expect.element(deleted.getByText('Deleted · 22 days left')).toBeVisible()
    await expect.element(page.getByText('Deleted', { exact: true })).toBeVisible()
  })

  it('leaves out the deleted group when none is deleted', async () => {
    await show(workspaces.slice(0, 2))
    await expect.element(page.getByRole('list', { name: 'Workspaces', exact: true })).toBeVisible()
    expect(page.getByRole('list', { name: 'Deleted workspaces' }).elements()).toHaveLength(0)
  })

  it('opens the workspace hub from a row, a deleted workspace too', async () => {
    const { router } = await show()
    await page.getByRole('link', { name: /Globex/ }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/globex/settings')
  })

  it('opens the hub of a deleted workspace, where Restore lives', async () => {
    const { router } = await show()
    await page.getByRole('link', { name: /Old Co/ }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/old-co/settings')
  })

  it('finds a workspace by what is typed, the deleted ones included', async () => {
    await show()
    await expect.element(page.getByText('Globex', { exact: true })).toBeVisible()
    await userEvent.type(page.getByRole('textbox', { name: 'Find workspaces' }), 'old')
    await expect
      .poll(() =>
        page.getByRole('list', { name: 'Deleted workspaces' }).getByRole('listitem').elements(),
      )
      .toHaveLength(1)
    expect(page.getByRole('list', { name: 'Workspaces', exact: true }).elements()).toHaveLength(0)
    await userEvent.fill(page.getByRole('textbox', { name: 'Find workspaces' }), 'zzz')
    await expectEmptyState('No workspace matches “zzz”', { action: 'Clear search' })
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect.element(page.getByRole('textbox', { name: 'Find workspaces' })).toHaveValue('')
  })

  it('puts the find field and New workspace in the page header, on a desktop', async () => {
    await page.viewport(1280, 800)
    await show()
    await expect.element(page.getByRole('list', { name: 'Workspaces', exact: true })).toBeVisible()
    const header = pageHeader()
    expect(header.contains(page.getByRole('textbox', { name: 'Find workspaces' }).element())).toBe(
      true,
    )
    expect(header.contains(page.getByRole('button', { name: 'New workspace' }).element())).toBe(
      true,
    )
  })

  it('names the page in its breadcrumb: Instance, then Workspaces', async () => {
    await show()
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect.element(crumbs.getByText('Instance')).toBeVisible()
    await expect.element(page.getByRole('heading', { name: 'Workspaces', level: 1 })).toBeVisible()
  })

  it('creates a workspace from New workspace', async () => {
    await show()
    await page.getByRole('button', { name: 'New workspace' }).click()
    await expect.element(page.getByRole('dialog', { name: 'Create workspace' })).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: "Owner's email" })).toBeVisible()
  })

  it('has an empty state with no second New workspace button', async () => {
    await show([])
    await expectEmptyState('No workspaces yet')
    expect(page.getByRole('button', { name: 'New workspace' }).elements()).toHaveLength(1)
  })

  it('says so to someone who is not an instance admin', async () => {
    await renderPage(<WorkspacesPage />, {
      route: '/instance/workspaces',
      api: { 'GET /api/instance/workspaces': { status: 403, body: { error: 'Forbidden' } } },
    })
    await expect.element(page.getByRole('heading', { name: 'Instance admins only' })).toBeVisible()
  })
})
