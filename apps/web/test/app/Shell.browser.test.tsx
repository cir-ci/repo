import { CirciTheme } from '@circi/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it (nothing here talks to a server).
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { Shell } from '#app/Shell.tsx'
import { mockAuthClient, setSignedInUser } from '#test/support/auth-client.ts'

const overview = (workspace: string, workspaceName: string, team: string) => ({
  workspace: { slug: workspace, name: workspaceName },
  team: { slug: team, name: team, defaultBranch: 'main' },
  latestBuild: null,
})

const SIDEBAR_ACME = {
  teams: [
    {
      slug: 'web-app',
      name: 'web-app',
      pinned: true,
      triage: 4,
      color: 'slate',
      icon: 'layout-grid',
    },
    {
      slug: 'storybook',
      name: 'storybook',
      pinned: false,
      triage: 0,
      color: 'olive',
      icon: null,
    },
    { slug: 'api', name: 'api', pinned: false, triage: 0, color: 'olive', icon: null },
  ],
  views: [
    {
      id: 'v1',
      name: 'Failing on main',
      filters: {},
      pinned: true,
      position: 0,
      team: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'v2',
      name: 'Not pinned',
      filters: {},
      pinned: false,
      position: 1,
      team: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  inboxUnread: 3,
  reviews: 2,
}

// The data API is the other edge: answers by path.
const API: Record<string, unknown> = {
  '/api/teams': {
    teams: [
      overview('acme', 'Acme', 'web-app'),
      overview('acme', 'Acme', 'api'),
      overview('acme', 'Acme', 'storybook'),
      overview('globex', 'Globex', 'portal'),
    ],
  },
  '/api/workspaces/acme/sidebar': SIDEBAR_ACME,
  '/api/workspaces/globex/sidebar': {
    teams: [
      { slug: 'portal', name: 'portal', pinned: false, triage: 0, color: 'olive', icon: null },
    ],
    views: [],
    inboxUnread: 0,
    reviews: 0,
  },
  '/api/capabilities': {
    canCreateWorkspace: false,
    instanceAdmin: false,
    manageableWorkspaces: [],
    refusingWorkspaces: [],
  },
  '/api/instance/notices': {},
  '/api/setup': { needed: false },
  '/api/auth-methods': { password: true, email: false, sso: [] },
}

const BASE_CAPS = API['/api/capabilities']

/** Whether the person runs the instance is the server's answer (`/api/capabilities`), not the session's. */
function asInstanceAdmin() {
  API['/api/capabilities'] = {
    canCreateWorkspace: false,
    instanceAdmin: true,
    manageableWorkspaces: [],
    refusingWorkspaces: [],
  }
}

const text = (content: string) => () => <p>{content}</p>

async function renderShell(path: string) {
  const root = createRootRoute({ component: Shell })
  const routes = [
    createRoute({ getParentRoute: () => root, path: '/', component: text('Teams page') }),
    createRoute({
      getParentRoute: () => root,
      path: 'account/profile',
      component: text('Profile page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: 'instance/accounts',
      component: text('Instance accounts page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: 'workspaces/$workspace/settings/members',
      component: text('Members page'),
    }),
    createRoute({ getParentRoute: () => root, path: 'inbox', component: text('Inbox page') }),
    createRoute({
      getParentRoute: () => root,
      path: 'workspaces/$workspace/reviews',
      component: text('Reviews page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: 'workspaces/$workspace/insights',
      component: text('Insights page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: 'workspaces/$workspace/settings',
      component: text('Workspace settings page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: '$workspace/$team/settings',
      component: text('Team settings page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: '$workspace/$team/triage',
      component: text('Triage page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: '$workspace/$team',
      component: text('Builds page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: '$workspace/$team/sites',
      component: text('Sites page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: '_sso/site',
      component: text('Handoff page'),
    }),
  ]
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(
    <CirciTheme>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </CirciTheme>,
  )
  return { router, queryClient }
}

const auth = mockAuthClient()

beforeEach(() => {
  auth.signOut.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
        .pathname
      const body = API[path]
      return Promise.resolve(
        body === undefined
          ? new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
          : new Response(JSON.stringify(body), { status: 200 }),
      )
    }),
  )
})

afterEach(() => {
  API['/api/capabilities'] = BASE_CAPS
  vi.unstubAllGlobals()
})

describe('Shell, wide', () => {
  it('shows the sidebar navigation, the workspace’s teams and the page in the panel', async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect.element(nav).toBeVisible()
    await expect.element(nav.getByRole('button', { name: /Search/ })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'Teams', exact: true })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'Insights' })).toBeVisible()
    // Settings open from the workspace menu above, not from the sidebar.
    expect(nav.getByRole('link', { name: 'Settings' }).elements()).toHaveLength(0)
    await expect.element(nav.getByRole('link', { name: 'storybook' })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: /^web-app/ })).toBeVisible()
    expect(nav.getByRole('link', { name: 'portal' }).elements()).toHaveLength(0)
    await expect.element(page.getByRole('main')).toHaveTextContent('Teams page')
  })

  it('shows the Inbox and Reviews counts and the pinned views', async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect
      .element(nav.getByRole('link', { name: 'Inbox , 3 unread notifications' }))
      .toBeVisible()
    await expect
      .element(nav.getByRole('link', { name: 'Reviews , 2 reviews waiting' }))
      .toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'Failing on main' })).toBeVisible()
    expect(nav.getByRole('link', { name: 'Not pinned' }).elements()).toHaveLength(0)
  })

  it('lists pinned teams first, then the rest A to Z', async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect.element(nav.getByRole('link', { name: 'api' })).toBeVisible()
    const names = (label: string) =>
      nav
        .getByRole('region', { name: label })
        .getByRole('link')
        .elements()
        .map((el) => el.getAttribute('href'))
    expect(names('Pinned')).toEqual(['/acme/web-app'])
    expect(names('Teams')).toEqual(['/acme/api', '/acme/storybook'])
  })

  it('marks the current page with aria-current', async () => {
    await page.viewport(1280, 800)
    await renderShell('/workspaces/acme/reviews')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect
      .element(nav.getByRole('link', { name: 'Reviews , 2 reviews waiting' }))
      .toHaveAttribute('aria-current', 'page')
    await expect
      .element(nav.getByRole('link', { name: 'Teams', exact: true }))
      .not.toHaveAttribute('aria-current')
  })

  it('opens the open team’s pages under it, with the Triage count', async () => {
    await page.viewport(1280, 800)
    await renderShell('/acme/web-app/triage')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect
      .element(nav.getByRole('link', { name: 'Triage , 4 items to triage' }))
      .toHaveAttribute('aria-current', 'page')
    await expect.element(nav.getByRole('link', { name: 'Builds' })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'Baselines' })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'Sites' })).toBeVisible()
    // No Settings under the team: team settings open from the workspace menu's settings.
    expect(nav.getByRole('link', { name: 'Settings' }).elements()).toHaveLength(0)
    // Other teams stay collapsed.
    expect(nav.getByRole('link', { name: 'Builds' }).elements()).toHaveLength(1)
  })

  it('navigates without a page reload', async () => {
    await page.viewport(1280, 800)
    const { router } = await renderShell('/')
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Insights' })
      .click()
    await expect.element(page.getByRole('main')).toHaveTextContent('Insights page')
    expect(router.state.location.pathname).toBe('/workspaces/acme/insights')
  })

  it('lists the workspaces in the switcher and follows the one chosen', async () => {
    await page.viewport(1280, 800)
    const { router } = await renderShell('/acme/web-app')
    const trigger = page.getByRole('button', { name: 'Workspace: Acme' })
    await trigger.click()
    // Two workspaces, Workspace settings (no right to create one).
    expect(page.getByRole('menuitem').elements()).toHaveLength(3)
    await expect
      .element(page.getByRole('menuitem', { name: 'Acme' }))
      .toHaveAttribute('aria-current', 'true')
    await page.getByRole('menuitem', { name: 'Globex' }).click()
    await expect.element(page.getByRole('button', { name: 'Workspace: Globex' })).toBeVisible()
    await expect
      .element(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'portal' }))
      .toBeVisible()
    // A team page stays a team page: the same section of the new workspace's first team.
    expect(router.state.location.pathname).toBe('/globex/portal')
  })

  it('still shows the name when there is only one workspace', async () => {
    await page.viewport(1280, 800)
    API['/api/teams'] = { teams: [overview('acme', 'Acme', 'web-app')] }
    try {
      await renderShell('/')
      await expect.element(page.getByRole('button', { name: 'Workspace: Acme' })).toBeVisible()
    } finally {
      API['/api/teams'] = {
        teams: [
          overview('acme', 'Acme', 'web-app'),
          overview('acme', 'Acme', 'api'),
          overview('acme', 'Acme', 'storybook'),
          overview('globex', 'Globex', 'portal'),
        ],
      }
    }
  })

  it('has the user menu with account, theme and sign out', async () => {
    await page.viewport(1280, 800)
    const { queryClient } = await renderShell('/')
    queryClient.setQueryData(['marker'], 1)
    await page.getByRole('button', { name: 'Account menu for Ada Lovelace' }).click()
    await expect.element(page.getByText('ada@example.test')).toBeVisible()
    await expect.element(page.getByRole('menuitem', { name: 'Profile and sessions' })).toBeVisible()
    await expect.element(page.getByRole('menuitem', { name: 'Notifications' })).toBeVisible()
    await expect.element(page.getByRole('menuitem', { name: /Keyboard shortcuts/ })).toBeVisible()
    await expect.element(page.getByRole('group', { name: 'Theme' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Dark' })).toBeVisible()
    // Only people who run the instance see its admin pages.
    expect(page.getByRole('menuitem', { name: 'Instance admin' }).elements()).toHaveLength(0)
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect.poll(() => auth.signOut.mock.calls.length).toBe(1)
    // Everything fetched as this person is forgotten.
    await expect.poll(() => queryClient.getQueryData(['marker'])).toBeUndefined()
  })

  it('goes to the account page from the user menu', async () => {
    await page.viewport(1280, 800)
    const { router } = await renderShell('/')
    await page.getByRole('button', { name: 'Account menu for Ada Lovelace' }).click()
    await page.getByRole('menuitem', { name: 'Profile and sessions' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/account/profile')
  })

  it('has a skip link to the main content', async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    const skip = page.getByRole('link', { name: 'Skip to content' })
    await expect.element(skip).toHaveAttribute('href', '#content')
    expect(document.getElementById('content')).not.toBeNull()
  })
})

describe('Shell, keyboard', () => {
  it('goes to the Inbox with G then I', async () => {
    await page.viewport(1280, 800)
    const { router } = await renderShell('/')
    await expect.element(page.getByRole('main')).toHaveTextContent('Teams page')
    await userEvent.keyboard('gi')
    await expect.poll(() => router.state.location.pathname).toBe('/inbox')
    await userEvent.keyboard('gr')
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/acme/reviews')
    await userEvent.keyboard('gs')
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/acme/settings')
  })

  it('goes to the first team with Triage work on G then T', async () => {
    await page.viewport(1280, 800)
    const { router } = await renderShell('/')
    await expect
      .element(
        page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^web-app/ }),
      )
      .toBeVisible()
    await userEvent.keyboard('gt')
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app/triage')
  })

  it('does not take G while typing in a field', async () => {
    await page.viewport(1280, 800)
    const { router } = await renderShell('/')
    await expect.element(page.getByRole('main')).toHaveTextContent('Teams page')
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    await userEvent.keyboard('gi')
    expect(router.state.location.pathname).toBe('/')
    field.remove()
  })

  it('copies the link with ⌘⇧C', async () => {
    await page.viewport(1280, 800)
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    await renderShell('/')
    await expect.element(page.getByRole('main')).toHaveTextContent('Teams page')
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'C', metaKey: true, shiftKey: true, bubbles: true }),
    )
    await expect.poll(() => writeText.mock.calls.length).toBe(1)
    expect(writeText).toHaveBeenCalledWith(location.href)
  })
})

describe('Shell, settings', () => {
  it('replaces the sidebar with the settings nav: Back to app, Account, Workspace', async () => {
    await page.viewport(1280, 800)
    await renderShell('/workspaces/acme/settings/members')
    const nav = page.getByRole('navigation', { name: 'Settings' })
    await expect.element(nav).toBeVisible()
    expect(page.getByRole('navigation', { name: 'Main' }).elements()).toHaveLength(0)
    await expect.element(nav.getByRole('link', { name: 'Back to app' })).toBeVisible()
    await expect.element(nav.getByRole('region', { name: 'Account' })).toBeVisible()
    const workspace = nav.getByRole('region', { name: 'Workspace · Acme' })
    await expect.element(workspace).toBeVisible()
    const names = workspace
      .getByRole('link')
      .elements()
      .map((el) => el.textContent)
    expect(names).toEqual([
      'General',
      'Members',
      'Sign-in and domains',
      'Integrations',
      'Storage and retention',
    ])
    await expect
      .element(nav.getByRole('link', { name: 'Members' }))
      .toHaveAttribute('aria-current', 'page')
    await expect.element(page.getByText('Members page')).toBeVisible()
  })

  it('lists the account pages and marks the one open', async () => {
    await page.viewport(1280, 800)
    await renderShell('/account/profile')
    const account = page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('region', { name: 'Account' })
    const names = account
      .getByRole('link')
      .elements()
      .map((el) => el.textContent)
    expect(names).toEqual(['Profile', 'Notifications', 'Appearance', 'Keyboard shortcuts'])
    await expect
      .element(account.getByRole('link', { name: 'Profile' }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('shows the Team section for the team in the address, with its five pages', async () => {
    await page.viewport(1280, 800)
    await renderShell('/acme/web-app/settings')
    const team = page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('region', { name: 'Team · web-app' })
    await expect.element(team).toBeVisible()
    const names = team
      .getByRole('link')
      .elements()
      .map((el) => el.textContent)
    expect(names).toEqual([
      'General',
      'CI token',
      'Reviews and triage',
      'Webhooks',
      'Ignore regions',
    ])
    await expect
      .element(team.getByRole('link', { name: 'General' }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('keeps a team in the Team section off its own pages: the first team, or the last one used', async () => {
    await page.viewport(1280, 800)
    await renderShell('/account/profile')
    await expect
      .element(
        page
          .getByRole('navigation', { name: 'Settings' })
          .getByRole('region', { name: 'Team · web-app' }),
      )
      .toBeVisible()
  })

  it('shows the Instance section only to instance admins', async () => {
    await page.viewport(1280, 800)
    await renderShell('/account/profile')
    const nav = page.getByRole('navigation', { name: 'Settings' })
    expect(nav.getByRole('region', { name: /Instance/ }).elements()).toHaveLength(0)
    expect(nav.getByRole('link', { name: 'Health' }).elements()).toHaveLength(0)
  })

  it('shows the Instance section to an instance admin, with its four pages', async () => {
    await page.viewport(1280, 800)
    asInstanceAdmin()
    await renderShell('/instance/accounts')
    const section = page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('region', { name: /Instance/ })
    await expect.element(section).toBeVisible()
    const names = section
      .getByRole('link')
      .elements()
      .map((el) => el.textContent)
    expect(names).toEqual(['Accounts', 'Workspaces', 'Instance settings', 'Health'])
    await expect
      .element(section.getByRole('link', { name: 'Accounts' }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('switches team from the section header and stays on the same settings page', async () => {
    await page.viewport(1280, 800)
    const { router } = await renderShell('/acme/web-app/settings/reviews')
    await page.getByRole('button', { name: 'Switch team' }).click()
    const panel = page.getByRole('dialog', { name: 'Switch team' })
    await expect
      .element(panel.getByRole('link', { name: 'web-app' }))
      .toHaveAttribute('aria-current', 'true')
    await panel.getByRole('searchbox', { name: 'Find a team' }).fill('stor')
    expect(panel.getByRole('link').elements()).toHaveLength(1)
    await panel.getByRole('link', { name: 'storybook' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/storybook/settings/reviews')
  })

  it('moves through the team switcher with the arrow keys and closes it with Escape', async () => {
    await page.viewport(1280, 800)
    await renderShell('/acme/web-app/settings')
    const trigger = page.getByRole('button', { name: 'Switch team' })
    await trigger.click()
    const panel = page.getByRole('dialog', { name: 'Switch team' })
    panel.getByRole('searchbox', { name: 'Find a team' }).element().focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(panel.getByRole('link', { name: 'web-app' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(panel.getByRole('link', { name: 'api' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog', { name: 'Switch team' })).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })

  it('has no settings nav on other pages', async () => {
    await page.viewport(1280, 800)
    await renderShell('/inbox')
    await expect.element(page.getByRole('main')).toHaveTextContent('Inbox page')
    expect(page.getByRole('navigation', { name: 'Settings' }).elements()).toHaveLength(0)
  })
})

describe('Shell, menus', () => {
  it('opens the account menu with the keyboard, moves with arrows and returns focus on Escape', async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    const trigger = page.getByRole('button', { name: 'Account menu for Ada Lovelace' })
    await expect.element(trigger).toBeVisible()
    trigger.element().focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByRole('menu')).toBeVisible()
    await expect.element(page.getByRole('menuitem', { name: 'Profile and sessions' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('menuitem', { name: 'Notifications' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })

  it('changes the theme from the menu’s picker, which fits the menu, and marks <html>', async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    await page.getByRole('button', { name: 'Account menu for Ada Lovelace' }).click()
    const dark = page.getByRole('button', { name: 'Dark' })
    const light = page.getByRole('button', { name: 'Light' })
    // The three buttons are equal and none of them leaves the menu.
    const menu = page.getByRole('menu').element().getBoundingClientRect()
    const rects = [page.getByRole('button', { name: 'System' }), light, dark].map((b) =>
      b.element().getBoundingClientRect(),
    )
    expect(Math.abs(rects[0]!.width - rects[1]!.width)).toBeLessThan(1)
    expect(Math.abs(rects[1]!.width - rects[2]!.width)).toBeLessThan(1)
    expect(rects[2]!.right).toBeLessThanOrEqual(menu.right)
    await light.click()
    await expect.poll(() => document.documentElement.dataset.circiColorScheme).toBe('light')
    await expect.element(light).toHaveAttribute('aria-pressed', 'true')
    expect(getComputedStyle(document.documentElement).colorScheme).toBe('light')
    await dark.click()
    await expect.poll(() => document.documentElement.dataset.circiColorScheme).toBe('dark')
    await expect.element(dark).toHaveAttribute('aria-pressed', 'true')
    expect(getComputedStyle(document.documentElement).colorScheme).toBe('dark')
    expect(localStorage.getItem('circi-color-mode')).toBe('dark')
  })

  it('offers Instance admin in the account menu only to instance admins', async () => {
    await page.viewport(1280, 800)
    asInstanceAdmin()
    const { router } = await renderShell('/')
    await page.getByRole('button', { name: 'Account menu for Ada Lovelace' }).click()
    await page.getByRole('menuitem', { name: 'Instance admin' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/instance/accounts')
  })

  it('opens the workspace switcher with arrows, marks the current workspace, and has Workspace settings', async () => {
    await page.viewport(1280, 800)
    const { router } = await renderShell('/acme/web-app')
    const trigger = page.getByRole('button', { name: 'Workspace: Acme' })
    await expect.element(trigger).toBeVisible()
    trigger.element().focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('menu')).toBeVisible()
    await page.getByRole('menuitem', { name: 'Workspace settings' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/acme/settings')
  })

  it('offers New workspace when the person may create one', async () => {
    await page.viewport(1280, 800)
    API['/api/capabilities'] = {
      canCreateWorkspace: true,
      instanceAdmin: false,
      manageableWorkspaces: [],
      refusingWorkspaces: [],
    }
    try {
      await renderShell('/')
      await page.getByRole('button', { name: 'Workspace: Acme' }).click()
      await page.getByRole('menuitem', { name: 'New workspace' }).click()
      await expect.element(page.getByRole('dialog', { name: 'New workspace' })).toBeVisible()
    } finally {
      API['/api/capabilities'] = {
        canCreateWorkspace: false,
        instanceAdmin: false,
        manageableWorkspaces: [],
        refusingWorkspaces: [],
      }
    }
  })
})

describe('Shell, sidebar teams', () => {
  it('says “No teams yet” when the workspace has no teams, with no New team entry', async () => {
    await page.viewport(1280, 800)
    API['/api/capabilities'] = {
      canCreateWorkspace: false,
      instanceAdmin: false,
      manageableWorkspaces: [{ slug: 'acme', name: 'Acme' }],
      refusingWorkspaces: [],
    }
    API['/api/workspaces/acme/sidebar'] = { teams: [], views: [], inboxUnread: 0, reviews: 0 }
    try {
      await renderShell('/')
      const nav = page.getByRole('navigation', { name: 'Main' })
      await expect.element(nav.getByText('No teams yet')).toBeVisible()
      expect(nav.getByRole('button', { name: 'New team' }).elements()).toHaveLength(0)
      expect(nav.getByRole('region', { name: 'Pinned' }).elements()).toHaveLength(0)
      expect(nav.getByRole('region', { name: 'Your views' }).elements()).toHaveLength(0)
    } finally {
      API['/api/capabilities'] = {
        canCreateWorkspace: false,
        instanceAdmin: false,
        manageableWorkspaces: [],
        refusingWorkspaces: [],
      }
      API['/api/workspaces/acme/sidebar'] = SIDEBAR_ACME
    }
  })

  it('has no + or New team, and shows each team’s tile', async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect.element(nav.getByRole('link', { name: /^web-app/ })).toBeVisible()
    expect(nav.getByRole('button', { name: 'New team' }).elements()).toHaveLength(0)
    // One tile per team row (pinned web-app, then api and storybook).
    expect(nav.element().querySelectorAll('[data-color]')).toHaveLength(3)
    expect(nav.element().querySelector('[data-color="slate"]')).not.toBeNull()
  })
})

describe('Shell, outside the dashboard', () => {
  it('shows the sign-in page, without the sidebar, when nobody is signed in', async () => {
    await page.viewport(1280, 800)
    setSignedInUser(null)
    await renderShell('/')
    await expect.element(page.getByRole('heading', { name: 'Sign in to CirCI' })).toBeVisible()
    expect(page.getByRole('navigation', { name: 'Main' }).elements()).toHaveLength(0)
  })

  it('shows the site handoff without the sidebar', async () => {
    await page.viewport(1280, 800)
    await renderShell('/_sso/site')
    await expect.element(page.getByText('Handoff page')).toBeVisible()
    expect(page.getByRole('navigation', { name: 'Main' }).elements()).toHaveLength(0)
  })

  it('shows the site handoff without the old logo bar: the page brings its own layout', async () => {
    await page.viewport(1280, 800)
    await renderShell('/_sso/site')
    await expect.element(page.getByText('Handoff page')).toBeVisible()
    expect(page.getByRole('link', { name: 'CirCI home' }).elements()).toHaveLength(0)
    expect(page.getByRole('banner').elements()).toHaveLength(0)
  })
})

describe('Shell, narrow', () => {
  it('replaces the sidebar with a top bar and a menu button that opens it as a drawer', async () => {
    await page.viewport(390, 800)
    await renderShell('/workspaces/acme/reviews')
    expect(page.getByRole('navigation', { name: 'Main' }).elements()).toHaveLength(0)
    await expect.element(page.getByText('Reviews').first()).toBeVisible()
    await page.getByRole('button', { name: 'Open navigation' }).click()
    const drawer = page.getByRole('dialog', { name: 'Navigation' })
    await expect.element(drawer).toBeVisible()
    await expect
      .element(drawer.getByRole('link', { name: 'Reviews , 2 reviews waiting' }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('does not repeat "Settings" in the top bar above a settings page', async () => {
    await page.viewport(390, 800)
    await renderShell('/workspaces/acme/settings')
    await expect.element(page.getByRole('main')).toHaveTextContent('Workspace settings page')
    await expect.element(page.getByRole('button', { name: 'Open navigation' })).toBeVisible()
    expect(page.getByText('Settings', { exact: true }).elements()).toHaveLength(0)
  })

  it('closes the drawer once a page is chosen', async () => {
    await page.viewport(390, 800)
    const { router } = await renderShell('/')
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page
      .getByRole('dialog', { name: 'Navigation' })
      .getByRole('link', { name: /^web-app/ })
      .click()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app')
    await expect.poll(() => page.getByRole('dialog').elements().length).toBe(0)
    await expect.element(page.getByRole('main')).toHaveTextContent('Builds page')
  })
})
