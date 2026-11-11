import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { ProjectsSettingsPage } from '#features/project-settings/ProjectsSettingsPage.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { overview } from '#test/support/fixtures.ts'
import { pageHeader } from '#test/support/header.ts'
import { renderPage } from '#test/support/render.tsx'

const caps = (manageable: boolean) => ({
  canCreateWorkspace: false,
  instanceAdmin: false,
  manageableWorkspaces: manageable ? [{ slug: 'acme', name: 'Acme' }] : [],
  refusingWorkspaces: [],
})

const projects = [
  overview('acme', 'web-app'),
  overview('acme', 'storybook', { youAreMember: false, memberCount: 2 }),
  overview('globex', 'portal'),
]

const show = (manageable = true) =>
  renderPage(<ProjectsSettingsPage />, {
    route: '/workspaces/$workspace/settings/projects',
    url: '/workspaces/acme/settings/projects',
    otherRoutes: ['/$workspace/$project/settings'],
    api: {
      'GET /api/projects': { body: { projects } },
      'GET /api/capabilities': { body: caps(manageable) },
    },
  })

const renderEmpty = (manageable: boolean) =>
  renderPage(<ProjectsSettingsPage />, {
    route: '/workspaces/$workspace/settings/projects',
    url: '/workspaces/acme/settings/projects',
    api: {
      'GET /api/projects': { body: { projects: [] } },
      'GET /api/capabilities': { body: caps(manageable) },
    },
  })

describe('Settings, Projects', () => {
  it("lists the workspace's projects with their people and whether you are in them", async () => {
    await show()
    const list = page.getByRole('list', { name: 'Projects' })
    await expect.element(list.getByText('web-app', { exact: true })).toBeVisible()
    expect(list.getByRole('listitem').elements()).toHaveLength(2)
    await expect.element(list.getByText('acme/web-app')).toBeVisible()
    await expect.element(list.getByText('3 members')).toBeVisible()
    await expect.element(list.getByText('2 members')).toBeVisible()
    await expect.element(list.getByText('Member', { exact: true })).toBeVisible()
    await expect.element(list.getByText('Not a member')).toBeVisible()
    expect(page.getByText('portal').elements()).toHaveLength(0)
  })

  it('names the page in its breadcrumb: workspace, Settings, Projects', async () => {
    await show()
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    // The workspace is plain text: nothing links out of settings.
    await expect.element(crumbs.getByText('ACME')).toBeVisible()
    expect(crumbs.getByRole('link', { name: 'ACME' }).elements()).toHaveLength(0)
    await expect.element(crumbs.getByRole('link', { name: 'Settings' })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  })

  it('finds a project by what is typed', async () => {
    await show()
    await expect.element(page.getByText('storybook', { exact: true })).toBeVisible()
    await userEvent.type(page.getByRole('textbox', { name: 'Find projects' }), 'story')
    await expect
      .poll(() => page.getByRole('list', { name: 'Projects' }).getByRole('listitem').elements())
      .toHaveLength(1)
    await userEvent.fill(page.getByRole('textbox', { name: 'Find projects' }), 'zzz')
    await expectEmptyState('No project matches “zzz”', { action: 'Clear search' })
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect.element(page.getByRole('textbox', { name: 'Find projects' })).toHaveValue('')
  })

  it('puts the find field and New project in the page header, on a desktop', async () => {
    await page.viewport(1280, 800)
    await show()
    await expect.element(page.getByRole('list', { name: 'Projects' })).toBeVisible()
    const header = pageHeader()
    expect(header.contains(page.getByRole('textbox', { name: 'Find projects' }).element())).toBe(
      true,
    )
    expect(header.contains(page.getByRole('button', { name: 'New project' }).element())).toBe(true)
  })

  it('puts the find field in a full-width row under the header on a phone, New project in the header', async () => {
    await page.viewport(390, 844)
    await show()
    await expect.element(page.getByRole('list', { name: 'Projects' })).toBeVisible()
    const header = pageHeader()
    const find = page.getByRole('textbox', { name: 'Find projects' }).element()
    expect(header.contains(find)).toBe(false)
    expect(find.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      header.getBoundingClientRect().bottom - 1,
    )
    expect(find.getBoundingClientRect().height).toBeLessThanOrEqual(36.5)
    expect(header.contains(page.getByRole('button', { name: 'New project' }).element())).toBe(true)
  })

  it('invites an owner or admin to create the first project', async () => {
    await renderEmpty(true)
    await expectEmptyState('No projects yet', {
      body: 'Create a project to start uploading screenshots.',
    })
    await page.getByRole('button', { name: 'New project' }).click()
    expect(useOverlayStore.getState().newProjectOpen).toBe(true)
  })

  it('tells a member whom to ask, without a button', async () => {
    await renderEmpty(false)
    await expectEmptyState('No projects yet', { body: 'Ask an owner or admin to create one.' })
  })

  it("opens a project's settings from its row, owners and admins on General", async () => {
    const { router } = await show()
    await page.getByRole('link', { name: /web-app/ }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app/settings')
  })

  it('opens the settings hub for people who only belong to projects, who also get no New project button', async () => {
    const { router } = await show(false)
    await expect.element(page.getByRole('list', { name: 'Projects' })).toBeVisible()
    expect(page.getByRole('button', { name: 'New project' }).elements()).toHaveLength(0)
    await page.getByRole('link', { name: /web-app/ }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app/settings')
  })

  it('offers New project to owners and admins', async () => {
    await show()
    await page.getByRole('button', { name: 'New project' }).click()
    expect(useOverlayStore.getState().newProjectOpen).toBe(true)
  })
})
