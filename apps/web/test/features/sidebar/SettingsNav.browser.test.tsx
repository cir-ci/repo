import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { SettingsNav } from '#features/sidebar/SettingsNav.tsx'
import { useSettingsReturnStore } from '#lib/stores/settings-return-store.ts'
import { workspace as instanceWorkspace } from '#test/features/instance/fixtures.ts'
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
      'GET /api/instance/workspaces': {
        body: {
          workspaces: [
            instanceWorkspace(),
            instanceWorkspace({ id: 'w2', name: 'Globex', slug: 'globex', youAreMember: false }),
            instanceWorkspace({
              id: 'w3',
              name: 'Old Co',
              slug: 'old-co',
              deletedAt: '2026-11-01T00:00:00.000Z',
              daysLeft: 22,
            }),
          ],
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

/** The names of the entries the nav marks as the current page. */
const selected = () =>
  page
    .getByRole('link')
    .elements()
    .filter((el) => el.getAttribute('aria-current') === 'page')
    .map((el) => el.textContent)

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
    // Workspaces are their own section now: the Instance section has no entry for them.
    expect(names(instance.getByRole('link'))).toEqual(['Accounts', 'Instance settings', 'Health'])
  })

  it('keeps the Workspace section, General at its own address, for an owner or admin', async () => {
    await show()
    const workspaceSection = page.getByRole('region', { name: /^Workspace ·/ })
    await expect
      .element(workspaceSection.getByRole('link', { name: 'General' }))
      .toHaveAttribute('href', '/workspaces/acme/settings/general')
    expect(page.getByRole('region', { name: 'Workspaces' }).elements()).toHaveLength(0)
    expect(page.getByRole('link', { name: 'All workspaces' }).elements()).toHaveLength(0)
  })

  describe('for an instance admin', () => {
    it('replaces the Workspace section with a Workspaces section: every live workspace, then All workspaces', async () => {
      await show({ instanceAdmin: true })
      const workspaces = page.getByRole('region', { name: 'Workspaces' })
      await expect.element(workspaces).toBeVisible()
      expect(names(workspaces.getByRole('link'))).toEqual(['Acme', 'Globex', 'All workspaces'])
      expect(page.getByRole('region', { name: /^Workspace ·/ }).elements()).toHaveLength(0)
      // Creating and the deleted ones live on the list page, not in the sidebar.
      expect(page.getByRole('button', { name: 'New workspace' }).elements()).toHaveLength(0)
      expect(page.getByRole('link', { name: 'Old Co' }).elements()).toHaveLength(0)
      // The Teams section stays, for the workspace being viewed.
      await expect
        .element(page.getByRole('region', { name: 'Teams' }).getByRole('link', { name: 'Web App' }))
        .toBeVisible()
    })

    it('ends the Workspaces section with All workspaces, which opens the list', async () => {
      await show({ instanceAdmin: true })
      await expect
        .element(
          page
            .getByRole('region', { name: 'Workspaces' })
            .getByRole('link', { name: 'All workspaces' }),
        )
        .toHaveAttribute('href', '/instance/workspaces')
    })

    it('opens a workspace at its settings hub', async () => {
      await show({ instanceAdmin: true })
      await expect
        .element(page.getByRole('link', { name: 'Globex' }))
        .toHaveAttribute('href', '/workspaces/globex/settings')
    })

    it.each([
      ['/workspaces/$workspace/settings', '/workspaces/acme/settings'],
      ['/workspaces/$workspace/settings/general', '/workspaces/acme/settings/general'],
      ['/workspaces/$workspace/settings/members', '/workspaces/acme/settings/members'],
      ['/workspaces/$workspace/settings/integrations', '/workspaces/acme/settings/integrations'],
    ])('marks the workspace on %s, and no other', async (route, url) => {
      await show({ instanceAdmin: true, route, url })
      await expect
        .element(page.getByRole('link', { name: 'Acme' }))
        .toHaveAttribute('aria-current', 'page')
      await expect
        .element(page.getByRole('link', { name: 'Globex' }))
        .not.toHaveAttribute('aria-current')
    })
  })

  describe('selects exactly one entry on every settings page', () => {
    it.each([
      [
        'the teams list',
        '/workspaces/$workspace/settings/teams',
        '/workspaces/acme/settings/teams',
        ['All teams'],
      ],
      [
        'the workspace hub',
        '/workspaces/$workspace/settings',
        '/workspaces/acme/settings',
        ['Acme'],
      ],
      [
        'General',
        '/workspaces/$workspace/settings/general',
        '/workspaces/acme/settings/general',
        ['Acme'],
      ],
      [
        'Members',
        '/workspaces/$workspace/settings/members',
        '/workspaces/acme/settings/members',
        ['Acme'],
      ],
      [
        'Sign-in',
        '/workspaces/$workspace/settings/sign-in',
        '/workspaces/acme/settings/sign-in',
        ['Acme'],
      ],
      [
        'Integrations',
        '/workspaces/$workspace/settings/integrations',
        '/workspaces/acme/settings/integrations',
        ['Acme'],
      ],
      [
        'Storage',
        '/workspaces/$workspace/settings/storage',
        '/workspaces/acme/settings/storage',
        ['Acme'],
      ],
      ['a team hub', '/$workspace/$team/settings', '/acme/web/settings', ['Web App']],
      [
        'a team page',
        '/$workspace/$team/settings/reviews',
        '/acme/web/settings/reviews',
        ['Web App'],
      ],
      ['All workspaces', '/instance/workspaces', '/instance/workspaces', ['All workspaces']],
      ['an account page', '/account/profile', '/account/profile', ['Profile']],
      ['an instance page', '/instance/health', '/instance/health', ['Health']],
    ])('for an instance admin on %s', async (_name, route, url, expected) => {
      await show({ instanceAdmin: true, route, url })
      await expect.element(page.getByRole('link', { name: 'All teams' })).toBeVisible()
      await expect.poll(selected).toEqual(expected)
    })

    it.each([
      [
        'the teams list',
        '/workspaces/$workspace/settings/teams',
        '/workspaces/acme/settings/teams',
        ['All teams'],
      ],
      [
        'General',
        '/workspaces/$workspace/settings/general',
        '/workspaces/acme/settings/general',
        ['General'],
      ],
      [
        'Members',
        '/workspaces/$workspace/settings/members',
        '/workspaces/acme/settings/members',
        ['Members'],
      ],
      [
        'Sign-in',
        '/workspaces/$workspace/settings/sign-in',
        '/workspaces/acme/settings/sign-in',
        ['Sign-in and domains'],
      ],
      [
        'Integrations',
        '/workspaces/$workspace/settings/integrations',
        '/workspaces/acme/settings/integrations',
        ['Integrations'],
      ],
      [
        'Storage',
        '/workspaces/$workspace/settings/storage',
        '/workspaces/acme/settings/storage',
        ['Storage and retention'],
      ],
      ['a team hub', '/$workspace/$team/settings', '/acme/web/settings', ['Web App']],
      [
        'a team page',
        '/$workspace/$team/settings/reviews',
        '/acme/web/settings/reviews',
        ['Web App'],
      ],
    ])('for an owner or admin on %s', async (_name, route, url, expected) => {
      await show({ route, url })
      await expect.element(page.getByRole('link', { name: 'All teams' })).toBeVisible()
      await expect.poll(selected).toEqual(expected)
    })
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
