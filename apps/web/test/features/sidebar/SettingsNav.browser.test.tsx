import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { SettingsNav } from '#features/sidebar/SettingsNav.tsx'
import { useSettingsReturnStore } from '#lib/stores/settings-return-store.ts'
import { workspace as instanceWorkspace } from '#test/features/instance/fixtures.ts'
import { overview, sidebarModel, sidebarProject } from '#test/support/fixtures.ts'
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
    route: options.route ?? '/$workspace/$project/settings/reviews',
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
      'GET /api/projects': { body: { projects: [overview('acme', 'web')] } },
      'GET /api/workspaces/acme/sidebar': {
        body: sidebarModel({
          canManage: options.canManage ?? true,
          projects: [sidebarProject(), sidebarProject({ slug: 'storybook', name: 'Storybook' })],
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
  it('lists every workspace page, with no Projects entry among them, for owners and admins', async () => {
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

  it('has a Projects section: each project opens its settings hub, then All projects opens the list', async () => {
    await show()
    const projects = page.getByRole('region', { name: 'Projects' })
    await expect.element(projects).toBeVisible()
    await expect
      .poll(() => names(projects.getByRole('link')))
      .toEqual(['Web App', 'Storybook', 'All projects'])
    await expect
      .element(projects.getByRole('link', { name: 'Storybook' }))
      .toHaveAttribute('href', '/acme/storybook/settings')
    await expect
      .element(projects.getByRole('link', { name: 'All projects' }))
      .toHaveAttribute('href', '/workspaces/acme/settings/projects')
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

  it('has no section per project and no project switcher: the Projects section is the switcher', async () => {
    await show()
    await expect.element(page.getByRole('region', { name: /^Workspace/ })).toBeVisible()
    expect(page.getByRole('region', { name: /^Project · / }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: /Switch project/ }).elements()).toHaveLength(0)
    expect(page.getByRole('link', { name: 'CI token' }).elements()).toHaveLength(0)
  })

  it('leaves out what members cannot use: they keep Members, and the projects they can see', async () => {
    await show({ canManage: false })
    const workspace = page.getByRole('region', { name: /^Workspace/ })
    await expect.element(workspace.getByRole('link', { name: 'Members' })).toBeVisible()
    expect(names(workspace.getByRole('link'))).toEqual(['Members'])
    await expect
      .element(
        page.getByRole('region', { name: 'Projects' }).getByRole('link', { name: 'All projects' }),
      )
      .toBeVisible()
  })

  it('goes back to the page you came from, named for it', async () => {
    const { router } = await show({ from: '/acme/web/builds/148' })
    const link = page.getByRole('link', { name: 'Back to Build #148' })
    await expect.element(link).toHaveAttribute('href', '/acme/web/builds/148')
    await link.click()
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/acme/web/builds/148'))
  })

  it('names a project page by the project, and falls to the Inbox when there is no page to return to', async () => {
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

  it('marks the project while any page of its settings is open, and not the others or All projects', async () => {
    await show()
    await expect
      .element(page.getByRole('link', { name: 'Web App' }))
      .toHaveAttribute('aria-current', 'page')
    await expect
      .element(page.getByRole('link', { name: 'Storybook' }))
      .not.toHaveAttribute('aria-current')
    await expect
      .element(page.getByRole('link', { name: 'All projects' }))
      .not.toHaveAttribute('aria-current')
    await expect
      .element(page.getByRole('link', { name: 'Members' }))
      .not.toHaveAttribute('aria-current')
  })

  it('marks the project on its hub too', async () => {
    await show({ route: '/$workspace/$project/settings', url: '/acme/web/settings' })
    await expect
      .element(page.getByRole('link', { name: 'Web App' }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('marks All projects on the projects list', async () => {
    await show({
      route: '/workspaces/$workspace/settings/projects',
      url: '/workspaces/acme/settings/projects',
    })
    await expect
      .element(page.getByRole('link', { name: 'All projects' }))
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
    // One entry, like a workspace's or a project's: it opens the hub, which lists the pages. The
    // workspaces are their own section.
    expect(names(instance.getByRole('link'))).toEqual(['Instance'])
    await expect
      .element(instance.getByRole('link', { name: 'Instance' }))
      .toHaveAttribute('href', '/instance/overview')
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
      await expect
        .poll(() => names(workspaces.getByRole('link')))
        .toEqual(['Acme', 'Globex', 'All workspaces'])
      expect(page.getByRole('region', { name: /^Workspace ·/ }).elements()).toHaveLength(0)
      // Creating and the deleted ones live on the list page, not in the sidebar.
      expect(page.getByRole('button', { name: 'New workspace' }).elements()).toHaveLength(0)
      expect(page.getByRole('link', { name: 'Old Co' }).elements()).toHaveLength(0)
      // The Projects section stays, for the workspace being viewed.
      await expect
        .element(
          page.getByRole('region', { name: 'Projects' }).getByRole('link', { name: 'Web App' }),
        )
        .toBeVisible()
    })

    it("highlights the workspace being viewed while one of its projects' settings is the page", async () => {
      // The default address: /acme/web/settings/reviews, a page of the Web App project's settings.
      await show({ instanceAdmin: true })
      const workspaces = page.getByRole('region', { name: 'Workspaces' })
      const acme = workspaces.getByRole('link', { name: 'Acme' })
      await expect.element(acme).toBeVisible()
      // Acme is the workspace being viewed: highlighted, quieter than the page itself.
      await expect.element(acme).toHaveAttribute('data-within', '')
      await expect.element(acme).not.toHaveAttribute('aria-current')
      // The project is the page.
      await expect
        .element(
          page.getByRole('region', { name: 'Projects' }).getByRole('link', { name: 'Web App' }),
        )
        .toHaveAttribute('aria-current', 'page')
      // Another workspace isn't marked.
      await expect
        .element(workspaces.getByRole('link', { name: 'Globex' }))
        .not.toHaveAttribute('data-within')
      // The two highlights differ: the page has the accent bar, the workspace doesn't.
      expect(getComputedStyle(acme.element()).boxShadow).toBe('none')
      expect(getComputedStyle(acme.element()).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    })

    it('orders the sections by the hierarchy: Account, Instance, Workspaces, Projects', async () => {
      await show({ instanceAdmin: true })
      await expect.element(page.getByRole('region', { name: 'Projects' })).toBeVisible()
      await expect.element(page.getByRole('region', { name: 'Instance' })).toBeVisible()
      await expect.element(page.getByRole('region', { name: 'Workspaces' })).toBeVisible()
      const order = ['Account', 'Instance', 'Workspaces', 'Projects'].map((name) =>
        page.getByRole('region', { name }).element(),
      )
      order.slice(1).forEach((el, i) => {
        expect(
          order[i]!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy()
      })
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
        'the projects list',
        '/workspaces/$workspace/settings/projects',
        '/workspaces/acme/settings/projects',
        ['All projects'],
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
      ['a project hub', '/$workspace/$project/settings', '/acme/web/settings', ['Web App']],
      [
        'a project page',
        '/$workspace/$project/settings/reviews',
        '/acme/web/settings/reviews',
        ['Web App'],
      ],
      ['All workspaces', '/instance/workspaces', '/instance/workspaces', ['All workspaces']],
      ['an account page', '/account/profile', '/account/profile', ['Profile']],
      ['the Instance hub', '/instance/overview', '/instance/overview', ['Instance']],
      ['Accounts', '/instance/accounts', '/instance/accounts', ['Instance']],
      ['Instance settings', '/instance/settings', '/instance/settings', ['Instance']],
      ['Health', '/instance/health', '/instance/health', ['Instance']],
    ])('for an instance admin on %s', async (_name, route, url, expected) => {
      await show({ instanceAdmin: true, route, url })
      await expect.element(page.getByRole('link', { name: 'All projects' })).toBeVisible()
      await expect.poll(selected).toEqual(expected)
    })

    it.each([
      [
        'the projects list',
        '/workspaces/$workspace/settings/projects',
        '/workspaces/acme/settings/projects',
        ['All projects'],
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
      ['a project hub', '/$workspace/$project/settings', '/acme/web/settings', ['Web App']],
      [
        'a project page',
        '/$workspace/$project/settings/reviews',
        '/acme/web/settings/reviews',
        ['Web App'],
      ],
    ])('for an owner or admin on %s', async (_name, route, url, expected) => {
      await show({ route, url })
      await expect.element(page.getByRole('link', { name: 'All projects' })).toBeVisible()
      await expect.poll(selected).toEqual(expected)
    })
  })

  it('hides the Instance section from everyone else', async () => {
    await show()
    await expect.element(page.getByRole('region', { name: /^Workspace/ })).toBeVisible()
    expect(page.getByRole('region', { name: 'Instance' }).elements()).toHaveLength(0)
    expect(page.getByRole('link', { name: 'Instance' }).elements()).toHaveLength(0)
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
