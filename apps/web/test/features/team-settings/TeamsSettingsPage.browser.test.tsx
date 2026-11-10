import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { TeamsSettingsPage } from '#features/team-settings/TeamsSettingsPage.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { overview } from '#test/support/fixtures.ts'
import { renderPage } from '#test/support/render.tsx'

const caps = (manageable: boolean) => ({
  canCreateWorkspace: false,
  instanceAdmin: false,
  manageableWorkspaces: manageable ? [{ slug: 'acme', name: 'Acme' }] : [],
  refusingWorkspaces: [],
})

const teams = [
  overview('acme', 'web-app'),
  overview('acme', 'storybook', { youAreMember: false, memberCount: 2 }),
  overview('globex', 'portal'),
]

const show = (manageable = true) =>
  renderPage(<TeamsSettingsPage />, {
    route: '/workspaces/$workspace/settings/teams',
    url: '/workspaces/acme/settings/teams',
    otherRoutes: ['/$workspace/$team/settings', '/$workspace/$team/settings/members'],
    api: {
      'GET /api/teams': { body: { teams } },
      'GET /api/capabilities': { body: caps(manageable) },
    },
  })

describe('Settings, Teams', () => {
  it("lists the workspace's teams with their people and whether you are in them", async () => {
    await show()
    const list = page.getByRole('list', { name: 'Teams' })
    await expect.element(list.getByText('web-app', { exact: true })).toBeVisible()
    expect(list.getByRole('listitem').elements()).toHaveLength(2)
    await expect.element(list.getByText('acme/web-app')).toBeVisible()
    await expect.element(list.getByText('3 members')).toBeVisible()
    await expect.element(list.getByText('2 members')).toBeVisible()
    await expect.element(list.getByText('Member', { exact: true })).toBeVisible()
    await expect.element(list.getByText('Not a member')).toBeVisible()
    expect(page.getByText('portal').elements()).toHaveLength(0)
  })

  it('names the page in its breadcrumb: workspace, Settings, Teams', async () => {
    await show()
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    // The workspace is plain text: nothing links out of settings.
    await expect.element(crumbs.getByText('ACME')).toBeVisible()
    expect(crumbs.getByRole('link', { name: 'ACME' }).elements()).toHaveLength(0)
    await expect.element(crumbs.getByRole('link', { name: 'Settings' })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: 'Teams' })).toBeVisible()
  })

  it('finds a team by what is typed', async () => {
    await show()
    await expect.element(page.getByText('storybook', { exact: true })).toBeVisible()
    await userEvent.type(page.getByRole('textbox', { name: 'Find teams' }), 'story')
    await expect
      .poll(() => page.getByRole('list', { name: 'Teams' }).getByRole('listitem').elements())
      .toHaveLength(1)
    await userEvent.fill(page.getByRole('textbox', { name: 'Find teams' }), 'zzz')
    await expect.element(page.getByText('No teams match “zzz”.')).toBeVisible()
  })

  it("opens a team's settings from its row, owners and admins on General", async () => {
    const { router } = await show()
    await page.getByRole('link', { name: /web-app/ }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app/settings')
  })

  it('opens the Members tab for people who only belong to teams, who also get no New team button', async () => {
    const { router } = await show(false)
    await expect.element(page.getByRole('list', { name: 'Teams' })).toBeVisible()
    expect(page.getByRole('button', { name: 'New team' }).elements()).toHaveLength(0)
    await page.getByRole('link', { name: /web-app/ }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app/settings/members')
  })

  it('offers New team to owners and admins', async () => {
    await show()
    await page.getByRole('button', { name: 'New team' }).click()
    expect(useOverlayStore.getState().newTeamOpen).toBe(true)
  })
})
