import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { SettingsNav } from '#features/sidebar/SettingsNav.tsx'
import { useSettingsReturnStore } from '#lib/stores/settings-return-store.ts'
import { overview, sidebarModel, sidebarTeam } from '#test/support/fixtures.ts'
import { renderPage } from '#test/support/render.tsx'

function show(
  options: {
    url?: string
    route?: string
    instanceAdmin?: boolean
    canManage?: boolean
    /** The app page the person came from. */
    from?: string
  } = {},
) {
  return renderPage(<SettingsNav />, {
    beforeRender: () => {
      if (options.from) useSettingsReturnStore.getState().noteAppPage(options.from)
    },
    route: options.route ?? '/$workspace/$team/settings/reviews',
    url: options.url ?? '/acme/web/settings/reviews',
    viewport: [1000, 900],
    api: {
      'GET /api/capabilities': {
        body: {
          canCreateWorkspace: false,
          instanceAdmin: options.instanceAdmin ?? false,
          manageableWorkspaces: [],
          refusingWorkspaces: [],
          mailConfigured: false,
        },
      },
      'GET /api/teams': { body: { teams: [overview('acme', 'web')] } },
      'GET /api/workspaces/acme/sidebar': {
        body: sidebarModel({
          canManage: options.canManage ?? true,
          teams: [sidebarTeam(), sidebarTeam({ slug: 'storybook', name: 'Storybook' })],
        }),
      },
    },
  })
}

const names = (locator: ReturnType<typeof page.getByRole>) =>
  locator.elements().map((el) => el.textContent)

describe('SettingsNav', () => {
  it('lists every workspace page, with no Teams entry among them, for owners and admins', async () => {
    await show()
    const workspace = page.getByRole('region', { name: /^Workspace/ })
    await expect
      .element(workspace.getByRole('link', { name: 'Storage and retention' }))
      .toBeVisible()
    expect(names(workspace.getByRole('link'))).toEqual([
      'General',
      'Members',
      'Sign-in and domains',
      'Integrations',
      'Storage and retention',
    ])
  })

  it('has a Teams section: each team opens its settings hub, then All teams opens the list', async () => {
    await show()
    const teams = page.getByRole('region', { name: 'Teams' })
    await expect.element(teams).toBeVisible()
    expect(names(teams.getByRole('link'))).toEqual(['Web App', 'Storybook', 'All teams'])
    await expect
      .element(teams.getByRole('link', { name: 'Storybook' }))
      .toHaveAttribute('href', '/acme/storybook/settings')
    await expect
      .element(teams.getByRole('link', { name: 'All teams' }))
      .toHaveAttribute('href', '/workspaces/acme/settings/teams')
  })

  it('follows the sidebar numbers: 32px rows, 14px text, 18px icons at stroke 2, 13px secondary labels', async () => {
    await show()
    const link = page.getByRole('link', { name: 'Back to Inbox' })
    await expect.element(link).toBeVisible()
    const row = getComputedStyle(link.element())
    expect([row.height, row.fontSize]).toEqual(['32px', '14px'])
    const icon = link.element().querySelector('svg')!
    expect(icon.getBoundingClientRect().width).toBe(18)
    expect(getComputedStyle(icon).strokeWidth).toBe('2px')
    const label = page.getByRole('region', { name: 'Account' }).element()
      .firstElementChild!.firstElementChild!
    expect(getComputedStyle(label).fontSize).toBe('13px')
  })

  it('has no section per team and no team switcher: the Teams section is the switcher', async () => {
    await show()
    await expect.element(page.getByRole('region', { name: /^Workspace/ })).toBeVisible()
    expect(page.getByRole('region', { name: /^Team · / }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: /Switch team/ }).elements()).toHaveLength(0)
    expect(page.getByRole('link', { name: 'CI token' }).elements()).toHaveLength(0)
  })

  it('leaves out what members cannot use: they keep Members, and the teams they can see', async () => {
    await show({ canManage: false })
    const workspace = page.getByRole('region', { name: /^Workspace/ })
    await expect.element(workspace.getByRole('link', { name: 'Members' })).toBeVisible()
    expect(names(workspace.getByRole('link'))).toEqual(['Members'])
    await expect
      .element(page.getByRole('region', { name: 'Teams' }).getByRole('link', { name: 'All teams' }))
      .toBeVisible()
  })

  it('goes back to the page you came from, named for it', async () => {
    const { router } = await show({ from: '/acme/web/builds/148' })
    const link = page.getByRole('link', { name: 'Back to Build #148' })
    await expect.element(link).toHaveAttribute('href', '/acme/web/builds/148')
    await link.click()
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/acme/web/builds/148'))
  })

  it('names a team page by the team, and falls to the Inbox when there is no page to return to', async () => {
    await show({ from: '/acme/web' })
    await expect
      .element(page.getByRole('link', { name: 'Back to Web App' }))
      .toHaveAttribute('href', '/acme/web')
  })

  it('goes back to the app and lists the account pages', async () => {
    await show()
    await expect.element(page.getByRole('link', { name: 'Back to Inbox' })).toBeVisible()
    const account = page.getByRole('region', { name: 'Account' })
    await expect.element(account).toBeVisible()
    expect(names(account.getByRole('link'))).toEqual([
      'Profile',
      'Notifications',
      'Appearance',
      'Keyboard shortcuts',
    ])
  })

  it('marks the team while any page of its settings is open, and not the others or All teams', async () => {
    await show()
    await expect
      .element(page.getByRole('link', { name: 'Web App' }))
      .toHaveAttribute('aria-current', 'page')
    await expect
      .element(page.getByRole('link', { name: 'Storybook' }))
      .not.toHaveAttribute('aria-current')
    await expect
      .element(page.getByRole('link', { name: 'All teams' }))
      .not.toHaveAttribute('aria-current')
    await expect
      .element(page.getByRole('link', { name: 'Members' }))
      .not.toHaveAttribute('aria-current')
  })

  it('marks the team on its hub too', async () => {
    await show({ route: '/$workspace/$team/settings', url: '/acme/web/settings' })
    await expect
      .element(page.getByRole('link', { name: 'Web App' }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('marks All teams on the teams list', async () => {
    await show({
      route: '/workspaces/$workspace/settings/teams',
      url: '/workspaces/acme/settings/teams',
    })
    await expect
      .element(page.getByRole('link', { name: 'All teams' }))
      .toHaveAttribute('aria-current', 'page')
    await expect
      .element(page.getByRole('link', { name: 'Web App' }))
      .not.toHaveAttribute('aria-current')
  })

  it('shows the Workspace section for the workspace in the address', async () => {
    await show({
      route: '/workspaces/$workspace/settings/members',
      url: '/workspaces/acme/settings/members',
    })
    const workspace = page.getByRole('region', { name: 'Workspace · ACME' })
    await expect.element(workspace).toBeVisible()
    await expect
      .element(workspace.getByRole('link', { name: 'Members' }))
      .toHaveAttribute('href', '/workspaces/acme/settings/members')
    await expect
      .element(workspace.getByRole('link', { name: 'Members' }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('shows the Instance section to instance admins only', async () => {
    await show({ instanceAdmin: true })
    const instance = page.getByRole('region', { name: /Instance/ })
    await expect.element(instance).toBeVisible()
    expect(names(instance.getByRole('link'))).toEqual([
      'Accounts',
      'Workspaces',
      'Instance settings',
      'Health',
    ])
  })

  it('hides the Instance section from everyone else', async () => {
    await show()
    await expect.element(page.getByRole('region', { name: /^Workspace/ })).toBeVisible()
    expect(page.getByRole('link', { name: 'Instance settings' }).elements()).toHaveLength(0)
  })

  it('lists Keyboard shortcuts under Account on a desktop and not on a phone', async () => {
    await show()
    await expect.element(page.getByRole('link', { name: 'Keyboard shortcuts' })).toBeVisible()
    await page.viewport(390, 844)
    await expect.element(page.getByRole('link', { name: 'Appearance' })).toBeVisible()
    await expect
      .poll(() => page.getByRole('link', { name: 'Keyboard shortcuts' }).elements().length)
      .toBe(0)
  })
})
