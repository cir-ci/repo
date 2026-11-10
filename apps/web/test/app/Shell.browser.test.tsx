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
import { PageHeading } from '#lib/PageHeading.tsx'
import { PANES } from '#lib/panes.ts'
import { PANES_KEY, usePaneStore } from '#lib/stores/pane-store.ts'
import { mockAuthClient, setSignedInUser } from '#test/support/auth-client.ts'
import { expectLimitedToSpace, parentOf } from '#test/support/resize.ts'

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
      siteCount: 2,
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
  canManage: true,
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
    canManage: true,
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
    createRoute({
      getParentRoute: () => root,
      path: 'headed',
      component: () => (
        <PageHeading crumbs={[{ label: 'Acme' }, { label: 'Builds' }]} title="Build #4" />
      ),
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
      path: '$workspace/$team/builds/$number',
      component: text('Build page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: '$workspace/$team/baselines',
      component: text('Baselines page'),
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
  it("shows the sidebar navigation, the workspace's teams and the page in the panel", async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect.element(nav).toBeVisible()
    // Search is an icon at the right of the workspace switcher, not an item of the list.
    const search = nav.getByRole('button', { name: 'Search', exact: true })
    await expect.element(search).toBeVisible()
    expect(nav.getByText('Search', { exact: true }).elements()).toHaveLength(0)
    expect(nav.getByText('⌘K').elements()).toHaveLength(0)
    await expect.element(nav.getByRole('link', { name: 'Teams', exact: true })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'Insights' })).toBeVisible()
    const switcher = nav
      .getByRole('button', { name: 'Workspace: Acme' })
      .element()
      .getBoundingClientRect()
    const icon = search.element().getBoundingClientRect()
    expect(icon.left).toBeGreaterThanOrEqual(switcher.right - 1)
    expect(
      Math.abs(icon.top + icon.height / 2 - (switcher.top + switcher.height / 2)),
    ).toBeLessThan(4)
    // Settings open from the workspace menu above, not from the sidebar.
    expect(nav.getByRole('link', { name: 'Settings' }).elements()).toHaveLength(0)
    await expect.element(nav.getByRole('link', { name: 'storybook' })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: /^web-app/ })).toBeVisible()
    expect(nav.getByRole('link', { name: 'portal' }).elements()).toHaveLength(0)
    await expect.element(page.getByRole('main')).toHaveTextContent('Teams page')
  })

  it("shows the notices inside the panel, right under the page's sticky header", async () => {
    await page.viewport(1280, 800)
    API['/api/instance/notices'] = {
      publicUrlChange: {
        from: 'https://old.example.com',
        to: 'https://ci.example.com',
        at: '2026-11-01T00:00:00Z',
        checklist: ['Update CIRCI_API_URL in CI'],
      },
    }
    try {
      await renderShell('/headed')
      const banner = page.getByRole('status').filter({ hasText: 'The dashboard moved from' })
      await expect.element(banner).toBeVisible()
      const header = page.getByRole('main').element().querySelector('header')
      const shown = banner.element()
      // Inside the panel (the main), straight after the header, not above it.
      expect(header).not.toBeNull()
      expect(page.getByRole('main').element().contains(shown)).toBe(true)
      expect(header?.nextElementSibling?.contains(shown)).toBe(true)
      expect(header && getComputedStyle(header).position).toBe('sticky')
    } finally {
      API['/api/instance/notices'] = {}
    }
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

  it('names one of something in the singular', async () => {
    await page.viewport(1280, 800)
    API['/api/workspaces/acme/sidebar'] = { ...SIDEBAR_ACME, inboxUnread: 1, reviews: 1 }
    try {
      await renderShell('/')
      const nav = page.getByRole('navigation', { name: 'Main' })
      await expect
        .element(nav.getByRole('link', { name: 'Inbox , 1 unread notification' }))
        .toBeVisible()
      await expect
        .element(nav.getByRole('link', { name: 'Reviews , 1 review waiting' }))
        .toBeVisible()
    } finally {
      API['/api/workspaces/acme/sidebar'] = SIDEBAR_ACME
    }
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

  it('hides Sites under a team that has no sites', async () => {
    await page.viewport(1280, 800)
    await renderShell('/acme/api/triage')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect.element(nav.getByRole('link', { name: 'Baselines' })).toBeVisible()
    expect(nav.getByRole('link', { name: 'Sites' }).elements()).toHaveLength(0)
  })

  it("opens the open team's pages under it, with the Triage count", async () => {
    await page.viewport(1280, 800)
    await renderShell('/acme/web-app/triage')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect
      .element(nav.getByRole('link', { name: 'Triage , 4 items to triage' }))
      .toHaveAttribute('aria-current', 'page')
    await expect.element(nav.getByRole('link', { name: 'Builds' })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'Baselines' })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'Sites' })).toBeVisible()
    // Each nested link has its Lucide icon (hammer, list-checks, image, globe), in the stroke the app uses.
    for (const [name, icon] of [
      ['Builds', 'lucide-hammer'],
      ['Triage', 'lucide-list-checks'],
      ['Baselines', 'lucide-image'],
      ['Sites', 'lucide-globe'],
    ] as const) {
      const link = nav.getByRole('link', { name: new RegExp(`^${name}\\b`) }).element()
      const svg = link.querySelector('svg')
      expect(svg?.classList.contains(icon), `${name} has the ${icon} icon`).toBe(true)
      expect(svg?.getAttribute('stroke-width')).toBe('1.75')
    }
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

describe('Shell, search button', () => {
  it('opens the command menu, and says ⌘K in its tooltip', async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    const search = page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Search', exact: true })
    await search.hover()
    await expect.element(page.getByText('⌘K')).toBeVisible()
    await search.click()
    await expect
      .element(page.getByRole('combobox', { name: 'Search or run a command' }))
      .toHaveFocus()
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
  it('replaces the sidebar with the settings nav: Back to Inbox, Account, Workspace', async () => {
    await page.viewport(1280, 800)
    await renderShell('/workspaces/acme/settings/members')
    const nav = page.getByRole('navigation', { name: 'Settings' })
    await expect.element(nav).toBeVisible()
    expect(page.getByRole('navigation', { name: 'Main' }).elements()).toHaveLength(0)
    await expect.element(nav.getByRole('link', { name: 'Back to Inbox' })).toBeVisible()
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
      'Teams',
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

  it("lists no team in the nav: a team's settings sit under Teams, which stays marked", async () => {
    await page.viewport(1280, 800)
    await renderShell('/acme/web-app/settings')
    const nav = page.getByRole('navigation', { name: 'Settings' })
    await expect.element(nav.getByRole('region', { name: 'Workspace · Acme' })).toBeVisible()
    expect(nav.getByRole('region', { name: /^Team · / }).elements()).toHaveLength(0)
    await expect
      .element(nav.getByRole('link', { name: 'Teams' }))
      .toHaveAttribute('aria-current', 'page')
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

  it("changes the theme from the menu's picker, which fits the menu, and marks <html>", async () => {
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
    API['/api/workspaces/acme/sidebar'] = {
      teams: [],
      views: [],
      inboxUnread: 0,
      reviews: 0,
      canManage: true,
    }
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

  it("has no + or New team, and shows each team's tile", async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect.element(nav.getByRole('link', { name: /^web-app/ })).toBeVisible()
    expect(nav.getByRole('button', { name: 'New team' }).elements()).toHaveLength(0)
    // One tile per team row (pinned web-app, then api and storybook).
    expect(nav.element().querySelectorAll('svg[data-avatar="marble"]')).toHaveLength(3)
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
    expect(page.getByRole('main').elements()).toHaveLength(0)
  })
})

describe('Shell, narrow', () => {
  it('replaces the sidebar with a top bar and a menu button that opens it as a drawer', async () => {
    await page.viewport(390, 800)
    await renderShell('/workspaces/acme/reviews')
    // The sidebar is the drawer's: the page has the phone's tab bar instead.
    expect(page.getByRole('navigation', { name: 'Main' }).elements()).toHaveLength(0)
    await expect.element(page.getByText('Reviews').first()).toBeVisible()
    await page.getByRole('button', { name: 'Open navigation' }).click()
    const drawer = page.getByRole('dialog', { name: 'Navigation' })
    await expect.element(drawer).toBeVisible()
    await expect
      .element(drawer.getByRole('link', { name: 'Reviews , 2 reviews waiting' }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('has the search button in the drawer, and it opens the command menu', async () => {
    await page.viewport(390, 800)
    await renderShell('/')
    await page.getByRole('button', { name: 'Open navigation' }).click()
    const drawer = page.getByRole('dialog', { name: 'Navigation' })
    const search = drawer.getByRole('button', { name: 'Search', exact: true })
    await expect.element(search).toBeVisible()
    expect(drawer.getByText('⌘K').elements()).toHaveLength(0)
    await search.click()
    await expect
      .element(page.getByRole('combobox', { name: 'Search or run a command' }))
      .toBeVisible()
  })

  it('names the area in the top bar above a settings page, with a Close that leaves it', async () => {
    await page.viewport(390, 800)
    await renderShell('/workspaces/acme/settings')
    await expect.element(page.getByRole('main')).toHaveTextContent('Workspace settings page')
    await expect.element(page.getByRole('button', { name: 'Open navigation' })).toBeVisible()
    await expect.element(page.getByText('Settings', { exact: true })).toBeVisible()
  })

  it('keeps the drawer open when a team is chosen, so its pages show, and closes it on a page', async () => {
    await page.viewport(390, 800)
    const { router } = await renderShell('/')
    await page.getByRole('button', { name: 'Open navigation' }).click()
    const drawer = page.getByRole('dialog', { name: 'Navigation' })
    await drawer.getByRole('link', { name: /^web-app/ }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app')
    // The team expanded in place: the drawer stays until a page (or the backdrop) dismisses it.
    await expect.element(drawer.getByRole('link', { name: /^Triage/ })).toBeVisible()
    await drawer.getByRole('link', { name: /^Triage/ }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app/triage')
    await expect.poll(() => page.getByRole('dialog').elements().length).toBe(0)
  })

  it('closes the drawer once a page is chosen, even the one already shown', async () => {
    await page.viewport(390, 800)
    const { router } = await renderShell('/acme/web-app')
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page
      .getByRole('dialog', { name: 'Navigation' })
      .getByRole('link', { name: /^Builds/ })
      .click()
    await expect.poll(() => page.getByRole('dialog').elements().length).toBe(0)
    expect(router.state.location.pathname).toBe('/acme/web-app')
    await expect.element(page.getByRole('main')).toHaveTextContent('Builds page')
  })
})

const show = () => page.getByRole('button', { name: 'Show sidebar' })
const hide = () => page.getByRole('button', { name: 'Hide sidebar' })

describe('Shell, collapsing the navigation', () => {
  it('hides the sidebar with its button, leaves a Show sidebar icon left of the breadcrumb and keeps it', async () => {
    await page.viewport(1280, 800)
    await renderShell('/headed')
    expect(show().elements()).toHaveLength(0)
    await hide().click()
    expect(page.getByRole('navigation', { name: 'Main' }).elements()).toHaveLength(0)
    await expect.element(show()).toBeVisible()
    await expect.element(show()).toHaveFocus()
    const icon = show().element().getBoundingClientRect()
    const crumbs = page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .element()
      .getBoundingClientRect()
    expect(icon.right).toBeLessThanOrEqual(crumbs.left)
    // It is the first thing in the panel's header, at its far left.
    const header = page.getByRole('main').element().getBoundingClientRect()
    expect(icon.left - header.left).toBeLessThan(24)
    expect(JSON.parse(localStorage.getItem(PANES_KEY) ?? '{}').state.collapsed.sidebar).toBe(true)
  })

  it('shows it again from the icon, with focus back on the Hide button', async () => {
    await page.viewport(1280, 800)
    await renderShell('/headed')
    await hide().click()
    await show().click()
    await expect.element(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await expect.element(hide()).toHaveFocus()
    expect(show().elements()).toHaveLength(0)
    expect(usePaneStore.getState().collapsed.sidebar).toBe(false)
  })

  it('starts collapsed when it was left collapsed', async () => {
    await page.viewport(1280, 800)
    usePaneStore.getState().setCollapsed('sidebar', true)
    await renderShell('/headed')
    await expect.element(show()).toBeVisible()
    expect(page.getByRole('navigation', { name: 'Main' }).elements()).toHaveLength(0)
  })

  it('toggles with the shortcut, which the shortcuts list names', async () => {
    await page.viewport(1280, 800)
    await renderShell('/headed')
    await userEvent.keyboard('{Meta>}\\{/Meta}')
    await expect.element(show()).toBeVisible()
    await userEvent.keyboard('{Meta>}\\{/Meta}')
    await expect.element(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await userEvent.keyboard('?')
    await expect.element(page.getByText('Hide or show the sidebar')).toBeVisible()
  })

  it('collapses when the handle is dragged well below the minimum', async () => {
    await page.viewport(1280, 800)
    await renderShell('/headed')
    const handle = page.getByRole('separator', { name: 'Resize the sidebar' })
    await expect.element(handle).toHaveAttribute('aria-valuenow', '244')
    const el = handle.element()
    const r = el.getBoundingClientRect()
    const fire = (type: string, x: number) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerId: 1,
          clientX: x,
          clientY: r.top + 40,
        }),
      )
    fire('pointerdown', r.left + 4)
    fire('pointermove', r.left + 4 - 200)
    await expect.element(show()).toBeVisible()
  })

  it('holds the sidebar to a share of the window, whatever width is stored', async () => {
    await page.viewport(900, 800)
    usePaneStore.getState().setWidth('sidebar', PANES.sidebar.max)
    await renderShell('/headed')
    const handle = page.getByRole('separator', { name: 'Resize the sidebar' })
    const sidebar = () => parentOf(handle.element())
    const frame = () => parentOf(sidebar())
    await expectLimitedToSpace(handle, 'sidebar', {
      pane: sidebar,
      main: () => document.getElementById('content')?.getBoundingClientRect().width ?? 0,
      container: frame,
      grows: 1,
      to: 820,
      collapsible: true,
      gap: 16,
    })
    expect(usePaneStore.getState().collapsed.sidebar).toBe(false)
  })

  it('collapses Settings navigation on its own, with its own names', async () => {
    await page.viewport(1280, 800)
    await renderShell('/account/profile')
    await page.getByRole('button', { name: 'Hide settings navigation' }).click()
    expect(page.getByRole('navigation', { name: 'Settings' }).elements()).toHaveLength(0)
    expect(usePaneStore.getState().collapsed).toEqual({ sidebar: false, 'settings-nav': true })
  })

  it('keeps the drawer and the hamburger below 820px, with no handle', async () => {
    await page.viewport(700, 800)
    usePaneStore.getState().setCollapsed('sidebar', true)
    await renderShell('/headed')
    await expect.element(page.getByRole('button', { name: 'Open navigation' })).toBeVisible()
    expect(page.getByRole('separator').elements()).toHaveLength(0)
    expect(show().elements()).toHaveLength(0)
  })
})

const tabs = () => page.getByRole('navigation', { name: 'Pages' })

describe('Shell, phone', () => {
  it('has a bottom tab bar with the counts, 44px targets and room for the home indicator', async () => {
    await page.viewport(390, 844)
    await renderShell('/inbox')
    await expect.element(tabs()).toBeVisible()
    // Reviews and Triage are links once the sidebar model says which workspace and team.
    await expect.poll(() => tabs().getByRole('link').elements().length).toBe(4)
    const names = tabs()
      .getByRole('link')
      .elements()
      .map((el) => el.textContent)
    expect(names).toEqual(['3Inbox, 3 unread', '2Reviews, 2 waiting', 'Triage', 'Teams'])
    await expect
      .element(tabs().getByRole('link', { name: /^Inbox/ }))
      .toHaveAttribute('aria-current', 'page')
    await expect.element(tabs().getByRole('button', { name: 'More' })).toBeVisible()
    for (const item of [
      ...tabs().getByRole('link').elements(),
      ...tabs().getByRole('button').elements(),
    ]) {
      const box = item.getBoundingClientRect()
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }
    // It sits on the bottom edge of the window.
    const bar = tabs().element().getBoundingClientRect()
    expect(Math.round(bar.bottom)).toBe(844)
    expect(getComputedStyle(tabs().element()).paddingBottom).toBe('0px')
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  })

  it('moves between Inbox, Reviews, Triage and Teams without a reload', async () => {
    await page.viewport(390, 844)
    const { router } = await renderShell('/inbox')
    await expect.poll(() => tabs().getByRole('link').elements().length).toBe(4)
    await tabs()
      .getByRole('link', { name: /^Reviews/ })
      .click()
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/acme/reviews')
    await expect
      .element(tabs().getByRole('link', { name: /^Reviews/ }))
      .toHaveAttribute('aria-current', 'page')
    await tabs().getByRole('link', { name: 'Triage' }).click()
    // The first team with work waiting.
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app/triage')
    await tabs().getByRole('link', { name: 'Teams' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/')
    await expect.element(page.getByRole('main')).toHaveTextContent('Teams page')
  })

  it('is full-bleed: the panel has no margin, border or rounded corners', async () => {
    await page.viewport(390, 844)
    await renderShell('/')
    const main = page.getByRole('main').element()
    const box = main.getBoundingClientRect()
    expect(Math.round(box.left)).toBe(0)
    expect(Math.round(box.right)).toBe(390)
    const style = getComputedStyle(main)
    expect(style.borderTopLeftRadius).toBe('0px')
    expect(style.borderLeftWidth).toBe('0px')
  })

  it('opens More as a sheet with Insights, Baselines and the settings entries, and closes it on a choice', async () => {
    await page.viewport(390, 844)
    const { router } = await renderShell('/acme/web-app/triage')
    await tabs().getByRole('button', { name: 'More' }).click()
    const sheet = page.getByRole('dialog', { name: 'More' })
    await expect.element(sheet).toBeVisible()
    const rows = sheet
      .getByRole('link')
      .elements()
      .map((el) => el.textContent)
    expect(rows).toEqual([
      'Insights',
      'Baselines',
      'Sites',
      'Failing on main',
      'Acme settings',
      'Account settings',
    ])
    for (const row of sheet.getByRole('link').elements()) {
      expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
    await sheet.getByRole('link', { name: 'Baselines' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app/baselines')
    await expect.poll(() => page.getByRole('dialog').elements().length).toBe(0)
  })

  it('has the account and workspace settings in More, and settings is left only by its Close', async () => {
    await page.viewport(390, 844)
    const { router } = await renderShell('/inbox')
    await tabs().getByRole('button', { name: 'More' }).click()
    await page
      .getByRole('dialog', { name: 'More' })
      .getByRole('link', { name: 'Account settings' })
      .click()
    await expect.poll(() => router.state.location.pathname).toBe('/account/profile')
    // Settings has its own navigation: no tab bar, a Close in the top bar, the list in the drawer.
    expect(tabs().elements()).toHaveLength(0)
    await page.getByRole('button', { name: 'Open navigation' }).click()
    const drawer = page.getByRole('dialog', { name: 'Navigation' })
    await expect.element(drawer.getByRole('link', { name: 'Back to Inbox' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await page.getByRole('button', { name: /^Close settings/ }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/inbox')
    await expect.element(tabs()).toBeVisible()
  })

  it('shows a build page without the tab bar: its own review bar takes the bottom', async () => {
    await page.viewport(390, 844)
    await renderShell('/acme/web-app/builds/7')
    await expect.element(page.getByRole('main')).toHaveTextContent('Build page')
    expect(tabs().elements()).toHaveLength(0)
  })

  it('opens search from the top bar as a full-screen sheet', async () => {
    await page.viewport(390, 844)
    await renderShell('/inbox')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Command menu' })
    await expect.element(dialog).toBeVisible()
    await expect.poll(() => Math.round(dialog.element().getBoundingClientRect().top)).toBe(0)
    const box = dialog.element().getBoundingClientRect()
    expect(Math.round(box.height)).toBe(844)
    expect(Math.round(box.width)).toBe(390)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect.poll(() => page.getByRole('dialog').elements().length).toBe(0)
  })

  it('has no tab bar on a wide screen', async () => {
    await page.viewport(1280, 800)
    await renderShell('/inbox')
    await expect.element(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    expect(tabs().elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'More' }).elements()).toHaveLength(0)
  })

  it.each(['/inbox', '/', '/workspaces/acme/reviews', '/acme/web-app/triage'])(
    'never scrolls sideways on %s',
    async (path) => {
      await page.viewport(390, 844)
      const { router } = await renderShell(path)
      await expect.poll(() => router.state.status).toBe('idle')
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    },
  )
})
