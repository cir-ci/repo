import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { SettingsNav } from '#app/SettingsNav.tsx'
import { sidebarModel, sidebarTeam } from '#test/support/fixtures.ts'
import { renderPage } from '#test/support/render.tsx'

const overview = (workspace: string, name: string, team: string) => ({
  workspace: { slug: workspace, name },
  team: { slug: team, name: team, defaultBranch: 'main', color: 'slate', icon: null },
  latestBuild: null,
})

function show(
  options: {
    url?: string
    route?: string
    instanceAdmin?: boolean
    teams?: ReturnType<typeof sidebarTeam>[]
    remember?: Record<string, string>
  } = {},
) {
  const teams = options.teams ?? [
    sidebarTeam({ slug: 'web', name: 'Web App' }),
    sidebarTeam({ slug: 'api', name: 'API' }),
  ]
  return renderPage(<SettingsNav />, {
    route: options.route ?? '/$workspace/$team/settings/reviews',
    url: options.url ?? '/acme/web/settings/reviews',
    viewport: [1000, 900],
    beforeRender: () => {
      for (const [key, value] of Object.entries(options.remember ?? {}))
        localStorage.setItem(key, value)
    },
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
      'GET /api/teams': { body: { teams: [overview('acme', 'Acme', 'web')] } },
      'GET /api/workspaces/acme/sidebar': { body: sidebarModel({ teams }) },
    },
  })
}

const names = (locator: ReturnType<typeof page.getByRole>) =>
  locator.elements().map((el) => el.textContent)

describe('SettingsNav', () => {
  it('goes back to the app and lists the account pages', async () => {
    await show()
    await expect.element(page.getByRole('link', { name: 'Back to app' })).toBeVisible()
    const account = page.getByRole('region', { name: 'Account' })
    await expect.element(account).toBeVisible()
    expect(names(account.getByRole('link'))).toEqual([
      'Profile',
      'Notifications',
      'Appearance',
      'Keyboard shortcuts',
    ])
  })

  it('shows the Team section for the team in the address, with the open page marked', async () => {
    await show()
    const team = page.getByRole('region', { name: 'Team · Web App' })
    await expect.element(team).toBeVisible()
    expect(names(team.getByRole('link'))).toEqual([
      'General',
      'CI token',
      'Reviews and triage',
      'Webhooks',
      'Ignore regions',
    ])
    await expect
      .element(team.getByRole('link', { name: 'Reviews and triage' }))
      .toHaveAttribute('aria-current', 'page')
    await expect
      .element(team.getByRole('link', { name: 'General' }))
      .not.toHaveAttribute('aria-current')
  })

  it('shows the Workspace section for the workspace in the address', async () => {
    await show({
      route: '/workspaces/$workspace/settings/members',
      url: '/workspaces/acme/settings/members',
    })
    const workspace = page.getByRole('region', { name: 'Workspace · Acme' })
    await expect.element(workspace).toBeVisible()
    await expect
      .element(workspace.getByRole('link', { name: 'Members' }))
      .toHaveAttribute('href', '/workspaces/acme/settings/members')
  })

  it('falls back to the team last used when the address names none', async () => {
    await show({
      route: '/account/profile',
      url: '/account/profile',
      remember: { 'circi-settings-team:acme': 'api' },
    })
    await expect.element(page.getByRole('region', { name: 'Team · API' })).toBeVisible()
  })

  it('has no Team section when the workspace has no teams', async () => {
    await show({ teams: [] })
    await expect.element(page.getByRole('region', { name: 'Workspace · Acme' })).toBeVisible()
    expect(page.getByRole('region', { name: /^Team · / }).elements()).toHaveLength(0)
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
    await expect.element(page.getByRole('region', { name: 'Team · Web App' })).toBeVisible()
    expect(page.getByRole('link', { name: 'Instance settings' }).elements()).toHaveLength(0)
  })
})
