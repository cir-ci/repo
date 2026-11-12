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
import { workspace as instanceWorkspace } from '#test/features/instance/fixtures.ts'
import { mockAuthClient, setSignedInUser } from '#test/support/auth-client.ts'
import { headerButton, pageHeader } from '#test/support/header.ts'
import { expectLimitedToSpace, parentOf } from '#test/support/resize.ts'

const overview = (workspace: string, workspaceName: string, project: string) => ({
  workspace: { slug: workspace, name: workspaceName },
  project: { slug: project, name: project, defaultBranch: 'main', color: 'slate', icon: null },
  latestBuild: null,
})

const SIDEBAR_ACME = {
  projects: [
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
      project: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'v2',
      name: 'Not pinned',
      filters: {},
      pinned: false,
      position: 1,
      project: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  inboxUnread: 3,
  reviews: 2,
  canManage: true,
}

// The data API is the other edge: answers by path.
const API: Record<string, unknown> = {
  '/api/projects': {
    projects: [
      overview('acme', 'Acme', 'web-app'),
      overview('acme', 'Acme', 'api'),
      overview('acme', 'Acme', 'storybook'),
      overview('globex', 'Globex', 'portal'),
    ],
  },
  '/api/workspaces/acme/sidebar': SIDEBAR_ACME,
  '/api/workspaces/globex/sidebar': {
    projects: [
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
  '/api/instance/workspaces': {
    workspaces: [
      instanceWorkspace(),
      instanceWorkspace({ id: 'w2', name: 'Globex', slug: 'globex' }),
    ],
  },
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

// Every page of the app has a header (`PageHeading`): on a phone it carries the search
// buttons. The test pages are only that header, titled with their text.
const text = (content: string) => () => <PageHeading title={content} />

async function renderShell(path: string) {
  const root = createRootRoute({ component: Shell })
  const routes = [
    createRoute({ getParentRoute: () => root, path: '/', component: text('Projects page') }),
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
      path: 'workspaces/$workspace/settings/general',
      component: text('Workspace general page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: '$workspace/$project/settings',
      component: text('Project settings page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: '$workspace/$project/triage',
      component: text('Triage page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: '$workspace/$project',
      component: text('Builds page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: '$workspace/$project/builds/$number',
      component: text('Build page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: '$workspace/$project/baselines',
      component: text('Baselines page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: '$workspace/$project/sites',
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
  it("shows the sidebar navigation, the workspace's projects and the page in the panel", async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect.element(nav).toBeVisible()
    // Search is an icon at the right of Inbox, at the top, not an item of the list.
    const search = nav.getByRole('button', { name: 'Search', exact: true })
    await expect.element(search).toBeVisible()
    expect(nav.getByText('Search', { exact: true }).elements()).toHaveLength(0)
    expect(nav.getByText('⌘K').elements()).toHaveLength(0)
    await expect.element(nav.getByRole('link', { name: 'Projects', exact: true })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'Insights' })).toBeVisible()
    const inbox = nav
      .getByRole('link', { name: /^Inbox/ })
      .element()
      .getBoundingClientRect()
    const icon = search.element().getBoundingClientRect()
    expect(icon.left).toBeGreaterThanOrEqual(inbox.right - 1)
    expect(Math.abs(icon.top + icon.height / 2 - (inbox.top + inbox.height / 2))).toBeLessThan(4)
    // Settings open from the workspace menu above, not from the sidebar.
    expect(nav.getByRole('link', { name: 'Settings' }).elements()).toHaveLength(0)
    await expect.element(nav.getByRole('link', { name: 'storybook' })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: /^web-app/ })).toBeVisible()
    expect(nav.getByRole('link', { name: 'portal' }).elements()).toHaveLength(0)
    await expect.element(page.getByRole('main')).toHaveTextContent('Projects page')
  })

  it('puts Inbox and Projects above the workspace switcher, and Reviews and Insights below it', async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect.element(nav.getByRole('link', { name: 'Insights' })).toBeVisible()
    const inbox = top(nav.getByRole('link', { name: /^Inbox/ }))
    const projects = top(nav.getByRole('link', { name: 'Projects', exact: true }))
    const switcher = top(nav.getByRole('button', { name: 'Workspace: Acme' }))
    const reviews = top(nav.getByRole('link', { name: /^Reviews/ }))
    const insights = top(nav.getByRole('link', { name: 'Insights' }))
    expect(inbox).toBeLessThan(projects)
    expect(projects).toBeLessThan(switcher)
    expect(switcher).toBeLessThan(reviews)
    expect(reviews).toBeLessThan(insights)
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

  it("draws Reviews with the design's check in a circle, not the comments' icon", async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    const reviews = page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: /^Reviews/ })
    await expect.element(reviews).toBeVisible()
    expect(reviews.element().querySelector('svg.lucide-circle-check-big')).not.toBeNull()
  })

  it('lists pinned projects first, then the rest A to Z', async () => {
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
    expect(names('Projects')).toEqual(['/acme/api', '/acme/storybook'])
    // Being under Pinned says it: the entry carries no pin of its own (only its tile is drawn).
    const pinnedEntry = nav.getByRole('region', { name: 'Pinned' }).getByRole('link').element()
    expect(pinnedEntry.querySelector('svg.lucide-pin')).toBeNull()
  })

  it('marks the current page with aria-current', async () => {
    await page.viewport(1280, 800)
    await renderShell('/workspaces/acme/reviews')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect
      .element(nav.getByRole('link', { name: 'Reviews , 2 reviews waiting' }))
      .toHaveAttribute('aria-current', 'page')
    await expect
      .element(nav.getByRole('link', { name: 'Projects', exact: true }))
      .not.toHaveAttribute('aria-current')
  })

  it('hides Sites under a project that has no sites', async () => {
    await page.viewport(1280, 800)
    await renderShell('/acme/api/triage')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect.element(nav.getByRole('link', { name: 'Baselines' })).toBeVisible()
    expect(nav.getByRole('link', { name: 'Sites' }).elements()).toHaveLength(0)
  })

  it("opens the open project's pages under it, with the Triage count", async () => {
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
    // No Settings under the project: project settings open from the workspace menu's settings.
    expect(nav.getByRole('link', { name: 'Settings' }).elements()).toHaveLength(0)
    // Other projects stay collapsed.
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
    // A project page stays a project page: the same section of the new workspace's first project.
    expect(router.state.location.pathname).toBe('/globex/portal')
  })

  it('still shows the name when there is only one workspace', async () => {
    await page.viewport(1280, 800)
    API['/api/projects'] = { projects: [overview('acme', 'Acme', 'web-app')] }
    try {
      await renderShell('/')
      await expect.element(page.getByRole('button', { name: 'Workspace: Acme' })).toBeVisible()
    } finally {
      API['/api/projects'] = {
        projects: [
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
    await expect.element(page.getByRole('main')).toHaveTextContent('Projects page')
    await userEvent.keyboard('gi')
    await expect.poll(() => router.state.location.pathname).toBe('/inbox')
    await userEvent.keyboard('gr')
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/acme/reviews')
    await userEvent.keyboard('gs')
    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/workspaces/acme/settings/general')
  })

  it('goes to the first project with Triage work on G then T', async () => {
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
    await expect.element(page.getByRole('main')).toHaveTextContent('Projects page')
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    await userEvent.keyboard('gi')
    await expect.poll(() => router.state.location.pathname).toBe('/')
    field.remove()
  })

  it('copies the link with ⌘⇧C', async () => {
    await page.viewport(1280, 800)
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    await renderShell('/')
    await expect.element(page.getByRole('main')).toHaveTextContent('Projects page')
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

  it("lists the projects in their own section: a project's settings keep its entry marked", async () => {
    await page.viewport(1280, 800)
    await renderShell('/acme/web-app/settings')
    const nav = page.getByRole('navigation', { name: 'Settings' })
    await expect.element(nav.getByRole('region', { name: 'Workspace · Acme' })).toBeVisible()
    expect(nav.getByRole('region', { name: /^Project · / }).elements()).toHaveLength(0)
    const projects = nav.getByRole('region', { name: 'Projects' })
    expect(
      projects
        .getByRole('link')
        .elements()
        .map((el) => el.textContent),
    ).toEqual(['web-app', 'storybook', 'api', 'All projects'])
    await expect
      .element(projects.getByRole('link', { name: 'web-app' }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('shows the Instance section only to instance admins', async () => {
    await page.viewport(1280, 800)
    await renderShell('/account/profile')
    const nav = page.getByRole('navigation', { name: 'Settings' })
    expect(nav.getByRole('region', { name: /Instance/ }).elements()).toHaveLength(0)
    expect(nav.getByRole('link', { name: 'Health' }).elements()).toHaveLength(0)
  })

  it('shows the Instance section to an instance admin, with one entry for every Instance page', async () => {
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
    expect(names).toEqual(['Instance'])
    await expect
      .element(section.getByRole('link', { name: 'Instance' }))
      .toHaveAttribute('href', '/instance/overview')
    await expect
      .element(section.getByRole('link', { name: 'Instance' }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('gives an instance admin a Workspaces section in place of the Workspace one, each opening its hub', async () => {
    await page.viewport(1280, 800)
    asInstanceAdmin()
    await renderShell('/instance/accounts')
    const nav = page.getByRole('navigation', { name: 'Settings' })
    const section = nav.getByRole('region', { name: 'Workspaces' })
    await expect.element(section).toBeVisible()
    await expect
      .poll(() =>
        section
          .getByRole('link')
          .elements()
          .map((el) => [el.textContent, el.getAttribute('href')]),
      )
      .toEqual([
        ['Acme', '/workspaces/acme/settings'],
        ['Globex', '/workspaces/globex/settings'],
        ['All workspaces', '/instance/workspaces'],
      ])
    expect(nav.getByRole('region', { name: /^Workspace ·/ }).elements()).toHaveLength(0)
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

  it('opens the workspace switcher with arrows, marks the current workspace, and has Settings', async () => {
    await page.viewport(1280, 800)
    const { router } = await renderShell('/acme/web-app')
    const trigger = page.getByRole('button', { name: 'Workspace: Acme' })
    await expect.element(trigger).toBeVisible()
    trigger.element().focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('menu')).toBeVisible()
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/workspaces/acme/settings/general')
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

describe('Shell, sidebar projects', () => {
  it('says “No projects yet” when the workspace has no projects, with no New project entry', async () => {
    await page.viewport(1280, 800)
    API['/api/capabilities'] = {
      canCreateWorkspace: false,
      instanceAdmin: false,
      manageableWorkspaces: [{ slug: 'acme', name: 'Acme' }],
      refusingWorkspaces: [],
    }
    API['/api/workspaces/acme/sidebar'] = {
      projects: [],
      views: [],
      inboxUnread: 0,
      reviews: 0,
      canManage: true,
    }
    try {
      await renderShell('/')
      const nav = page.getByRole('navigation', { name: 'Main' })
      await expect.element(nav.getByText('No projects yet')).toBeVisible()
      expect(nav.getByRole('button', { name: 'New project' }).elements()).toHaveLength(0)
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

  it("has no + or New project, and shows each project's tile", async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect.element(nav.getByRole('link', { name: /^web-app/ })).toBeVisible()
    expect(nav.getByRole('button', { name: 'New project' }).elements()).toHaveLength(0)
    // One tile per project row (pinned web-app, then api and storybook).
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

const top = (locator: { element: () => Element }) => locator.element().getBoundingClientRect().top

async function openMore(path: string) {
  await page.viewport(390, 844)
  const shell = await renderShell(path)
  await page.getByRole('button', { name: 'More' }).click()
  const menu = page.getByRole('menu')
  await expect.element(menu).toBeVisible()
  return { ...shell, menu }
}

describe('Shell, narrow', () => {
  const PHONE_PAGES = [
    '/',
    '/inbox',
    '/workspaces/acme/reviews',
    '/acme/web-app',
    '/headed',
    '/account/profile',
    '/workspaces/acme/settings',
    '/instance/accounts',
  ]

  it.each(PHONE_PAGES)('has no burger, no drawer and no sidebar buttons on %s', async (path) => {
    await page.viewport(390, 844)
    asInstanceAdmin()
    await renderShell(path)
    await expect.element(page.getByRole('main')).toBeVisible()
    expect(page.getByRole('navigation', { name: 'Main' }).elements()).toHaveLength(0)
    expect(page.getByRole('navigation', { name: 'Settings' }).elements()).toHaveLength(0)
    expect(page.getByRole('dialog').elements()).toHaveLength(0)
    for (const name of [
      'Open navigation',
      'Hide sidebar',
      'Show sidebar',
      'Hide settings navigation',
      'Show settings navigation',
    ]) {
      expect(page.getByRole('button', { name }).elements()).toHaveLength(0)
    }
  })

  it('has the phone tab bar, with More, instead of the sidebar', async () => {
    await page.viewport(390, 800)
    await renderShell('/workspaces/acme/reviews')
    await expect.element(page.getByRole('heading', { name: 'Reviews page' })).toBeVisible()
    await expect.element(tabs().getByRole('link', { name: /^Reviews/ })).toBeVisible()
    await expect.element(tabs().getByRole('button', { name: 'More' })).toBeVisible()
  })

  it('has no top bar: the search button is in the page header, one sticky row', async () => {
    await page.viewport(390, 844)
    await renderShell('/headed')
    await expect.element(page.getByRole('button', { name: 'Search' })).toBeVisible()
    const header = pageHeader()
    const button = headerButton('Search')
    expect(button).toBeDefined()
    expect(button!.getBoundingClientRect().height).toBeLessThanOrEqual(36.5)
    // The header is the first thing in the window, and the page's name is not repeated above it.
    // (The panel's own 1px top border is all that is above it.)
    expect(header.getBoundingClientRect().top).toBeLessThanOrEqual(1)
    expect(header.getBoundingClientRect().height).toBeLessThanOrEqual(52)
    expect(document.querySelectorAll('header')).toHaveLength(1)
  })

  it('has the sections and Close buttons of a settings page in its header, and no "Settings" bar above it', async () => {
    await page.viewport(390, 800)
    await renderShell('/workspaces/acme/settings')
    await expect.element(page.getByRole('main')).toHaveTextContent('Workspace settings page')
    await expect.poll(() => headerButton('Settings sections')).toBeDefined()
    await expect.poll(() => headerButton('Close settings, back to Inbox')).toBeDefined()
    expect(page.getByText('Settings', { exact: true }).elements()).toHaveLength(0)
  })

  it('opens the settings pages in a sheet from the header and reaches every section', async () => {
    await page.viewport(390, 844)
    asInstanceAdmin()
    const { router } = await renderShell('/workspaces/acme/settings')
    await expect.poll(() => headerButton('Settings sections')).toBeDefined()
    headerButton('Settings sections')!.click()
    const sheet = page.getByRole('dialog', { name: 'Settings sections' })
    await expect.element(sheet).toBeVisible()
    await expect
      .poll(() =>
        sheet
          .getByRole('link')
          .elements()
          .map((el) => el.textContent),
      )
      .toEqual([
        'Profile',
        'Notifications',
        'Appearance',
        // The hierarchy: Account, then Instance, Workspaces (every workspace of the instance, each
        // its hub, then All workspaces, in place of one's pages) and Projects.
        'Instance',
        'Acme',
        'Globex',
        'All workspaces',
        'web-app',
        'storybook',
        'api',
        'All projects',
      ])
    // No way back to the app from the list: the header's Close is the one way out.
    expect(sheet.getByRole('link', { name: /^Back to/ }).elements()).toHaveLength(0)
    await sheet.getByRole('link', { name: 'Globex' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/globex/settings')
    await expect.poll(() => page.getByRole('dialog').elements().length).toBe(0)
  })

  it("lists a workspace owner's pages in the sheet, General at its own address", async () => {
    await page.viewport(390, 844)
    await renderShell('/workspaces/acme/settings/members')
    await expect.poll(() => headerButton('Settings sections')).toBeDefined()
    headerButton('Settings sections')!.click()
    const sheet = page.getByRole('dialog', { name: 'Settings sections' })
    await expect.element(sheet).toBeVisible()
    expect(
      sheet
        .getByRole('link')
        .elements()
        .map((el) => el.textContent),
    ).toEqual([
      'Profile',
      'Notifications',
      'Appearance',
      'General',
      'Members',
      'Sign-in and domains',
      'Integrations',
      'Storage and retention',
      'web-app',
      'storybook',
      'api',
      'All projects',
    ])
    await expect
      .element(sheet.getByRole('link', { name: 'General' }))
      .toHaveAttribute('href', '/workspaces/acme/settings/general')
    await sheet.getByRole('link', { name: 'Members' }).click()
    await expect.poll(() => page.getByRole('dialog').elements().length).toBe(0)
  })

  it('closes the sections sheet when the page already shown is chosen', async () => {
    await page.viewport(390, 844)
    await renderShell('/workspaces/acme/settings/general')
    await expect.poll(() => headerButton('Settings sections')).toBeDefined()
    headerButton('Settings sections')!.click()
    await page
      .getByRole('dialog', { name: 'Settings sections' })
      .getByRole('link', { name: 'General' })
      .click()
    await expect.poll(() => page.getByRole('dialog').elements().length).toBe(0)
  })

  it('leaves settings with the header Close, back to the page the person came from', async () => {
    await page.viewport(390, 844)
    const { router } = await renderShell('/workspaces/acme/settings')
    await expect.poll(() => headerButton('Close settings, back to Inbox')).toBeDefined()
    headerButton('Close settings, back to Inbox')!.click()
    await expect.poll(() => router.state.location.pathname).toBe('/inbox')
    await expect
      .element(
        page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: /^Inbox/ }),
      )
      .toBeVisible()
  })

  describe('More', () => {
    it('starts with the workspaces, the open one marked, and switching one follows it', async () => {
      const { menu } = await openMore('/')
      const first = menu.getByRole('menuitem').first()
      await expect.element(first).toHaveTextContent('Acme')
      await expect.element(first).toHaveAttribute('aria-current', 'true')
      await menu.getByRole('menuitem', { name: /Globex/ }).click()
      await expect.poll(() => page.getByRole('menu').elements().length).toBe(0)
      // The menu follows the workspace chosen (its projects are on the Projects tab).
      await tabs().getByRole('button', { name: 'More' }).click()
      await expect.element(page.getByRole('menuitem', { name: 'Insights' })).toBeVisible()
      await expect
        .element(page.getByRole('menuitem', { name: /Globex/ }))
        .toHaveAttribute('aria-current', 'true')
    })

    it('offers New workspace where it is allowed', async () => {
      API['/api/capabilities'] = {
        canCreateWorkspace: true,
        instanceAdmin: false,
        manageableWorkspaces: [],
        refusingWorkspaces: [],
      }
      const { menu } = await openMore('/')
      await menu.getByRole('menuitem', { name: 'New workspace' }).click()
      await expect.poll(() => page.getByRole('menu').elements().length).toBe(0)
    })

    it('does not offer New workspace otherwise', async () => {
      const { menu } = await openMore('/')
      await expect.element(menu.getByRole('menuitem', { name: /Acme/ })).toBeVisible()
      expect(menu.getByRole('menuitem', { name: 'New workspace' }).elements()).toHaveLength(0)
    })

    it('keeps the rest: Insights, pinned views, settings and the account', async () => {
      const { menu } = await openMore('/')
      const names = menu
        .getByRole('menuitem')
        .elements()
        .map((el) => el.textContent?.trim())
      expect(names).toEqual(expect.arrayContaining(['Insights', 'Failing on main', 'Settings']))
      // What the Projects menu and the project page's tabs now hold is not repeated here.
      expect(menu.getByRole('menuitem', { name: 'Baselines' }).elements()).toHaveLength(0)
      expect(menu.getByRole('menuitem', { name: 'Sites' }).elements()).toHaveLength(0)
      expect(
        menu.getByRole('menuitem', { name: /^(web-app|api|storybook)/ }).elements(),
      ).toHaveLength(0)
      expect(menu.getByRole('menuitem', { name: 'Not pinned' }).elements()).toHaveLength(0)
      expect(menu.getByRole('separator').elements().length).toBeGreaterThanOrEqual(2)
    })

    it('signs out from the account entry', async () => {
      const { menu } = await openMore('/')
      await menu.getByRole('menuitem', { name: 'Sign out' }).click()
      await expect.poll(() => auth.signOut.mock.calls.length).toBe(1)
    })
  })

  describe('Projects tab', () => {
    const SINGLE = { projects: [overview('acme', 'Acme', 'web-app')] }
    const SEVERAL = API['/api/projects']

    afterEach(() => {
      API['/api/projects'] = SEVERAL
    })

    it('is labelled with the project when there is exactly one, with its tile as the icon', async () => {
      API['/api/projects'] = SINGLE
      await page.viewport(390, 844)
      await renderShell('/inbox')
      await expect.element(tabs().getByRole('button', { name: 'web-app' })).toBeVisible()
      expect(tabs().getByRole('button', { name: 'Projects' }).elements()).toHaveLength(0)
      expect(tiles()).toHaveLength(1)
    })

    it('is labelled Projects with a stack of up to three tiles when there are several', async () => {
      await page.viewport(390, 844)
      await renderShell('/inbox')
      await expect.element(tabs().getByRole('button', { name: 'Projects' })).toBeVisible()
      // Four projects, three tiles, overlapping.
      await expect.poll(() => tiles().length).toBe(3)
      const boxes = [...tiles()].map((el) => el.getBoundingClientRect())
      expect(boxes[1]!.left).toBeLessThan(boxes[0]!.right)
      expect(boxes[2]!.left).toBeLessThan(boxes[1]!.right)
      // Decoration, and still: no spreading on a phone.
      const stack = tiles()[0]!.closest('[data-spread]')!
      expect(stack.getAttribute('data-spread')).toBe('false')
    })

    it('truncates a long project name instead of growing the tab', async () => {
      API['/api/projects'] = {
        projects: [overview('acme', 'Acme', 'a-project-with-a-very-long-name-indeed')],
      }
      await page.viewport(390, 844)
      await renderShell('/inbox')
      const tab = tabs().getByRole('button', { name: /^a-project/ })
      await expect.element(tab).toBeVisible()
      const label = tab.element().lastElementChild
      if (!(label instanceof HTMLElement)) throw new Error('the tab has no label')
      expect(getComputedStyle(label).textOverflow).toBe('ellipsis')
      expect(label.scrollWidth).toBeGreaterThan(label.clientWidth)
      // Four tabs share the bar: Inbox, Projects, Reviews, More.
      expect(tab.element().getBoundingClientRect().width).toBeLessThanOrEqual(390 / 4 + 1)
    })

    it('opens a menu of your projects: pinned first, then by workspace, with triage counts', async () => {
      await page.viewport(390, 844)
      await renderShell('/inbox')
      await tabs().getByRole('button', { name: 'Projects' }).click()
      const menu = page.getByRole('menu')
      await expect.element(menu).toBeVisible()
      const names = menu
        .getByRole('menuitem')
        .elements()
        .map((el) => el.textContent?.trim())
      expect(
        names.map((n) =>
          n
            ?.split(/[0-9·]/)[0]
            ?.replace('Acme', '')
            .trim(),
        ),
      ).toEqual(['web-app', 'api', 'storybook', 'portal', 'All projects'])
      // The pinned project from a workspace of several names its workspace, with its count.
      await expect
        .poll(() => menu.getByRole('menuitem', { name: /^web-app/ }).element().textContent)
        .toContain('Acme · 4')
      // A separator between the groups and before All projects.
      expect(menu.getByRole('separator').elements().length).toBeGreaterThanOrEqual(3)
    })

    it('lists one workspace with no separators between projects', async () => {
      API['/api/projects'] = {
        projects: [overview('acme', 'Acme', 'web-app'), overview('acme', 'Acme', 'api')],
      }
      await page.viewport(390, 844)
      await renderShell('/inbox')
      await tabs().getByRole('button', { name: 'Projects' }).click()
      const menu = page.getByRole('menu')
      await expect.element(menu.getByRole('menuitem', { name: /^api/ })).toBeVisible()
      // Only the one before All projects.
      expect(menu.getByRole('separator').elements()).toHaveLength(1)
    })

    it('opens the chosen project and closes', async () => {
      await page.viewport(390, 844)
      const { router } = await renderShell('/inbox')
      await tabs().getByRole('button', { name: 'Projects' }).click()
      await page
        .getByRole('menu')
        .getByRole('menuitem', { name: /^portal/ })
        .click()
      await expect.poll(() => router.state.location.pathname).toBe('/globex/portal')
      await expect.poll(() => page.getByRole('menu').elements().length).toBe(0)
    })

    it('keeps an All projects item that opens the Projects page', async () => {
      await page.viewport(390, 844)
      const { router } = await renderShell('/acme/web-app/triage')
      await tabs().getByRole('button', { name: 'Projects' }).click()
      await page.getByRole('menu').getByRole('menuitem', { name: 'All projects' }).click()
      await expect.poll(() => router.state.location.pathname).toBe('/')
      await expect.element(page.getByRole('main')).toHaveTextContent('Projects page')
    })

    it('is not on a wide screen', async () => {
      await page.viewport(1280, 800)
      await renderShell('/inbox')
      await expect.element(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
      expect(page.getByRole('navigation', { name: 'Pages' }).elements()).toHaveLength(0)
    })
  })

  describe('project page tabs', () => {
    it('sit under the page header with Builds, Triage, Baselines and Sites, the current one selected', async () => {
      await page.viewport(390, 844)
      await renderShell('/acme/web-app/triage')
      await expect.element(strip()).toBeVisible()
      await expect.poll(() => strip().getByRole('tab').elements().length).toBe(4)
      expect(
        strip()
          .getByRole('tab')
          .elements()
          .map((el) => el.textContent),
      ).toEqual(['Builds', 'Triage', 'Baselines', 'Sites'])
      await expect
        .element(strip().getByRole('tab', { name: 'Triage' }))
        .toHaveAttribute('aria-selected', 'true')
      await expect
        .element(strip().getByRole('tab', { name: 'Builds' }))
        .toHaveAttribute('aria-selected', 'false')
      // Under the header, above the page.
      const header = pageHeader().getBoundingClientRect()
      expect(strip().element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
        header.bottom - 1,
      )
      for (const tab of strip().getByRole('tab').elements())
        expect(tab.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    })

    it('select the project’s Builds page on its address', async () => {
      await page.viewport(390, 844)
      await renderShell('/acme/web-app')
      await expect
        .element(strip().getByRole('tab', { name: 'Builds' }))
        .toHaveAttribute('aria-selected', 'true')
    })

    it('go to the project’s pages when chosen', async () => {
      await page.viewport(390, 844)
      const { router } = await renderShell('/acme/web-app')
      await strip().getByRole('tab', { name: 'Baselines' }).click()
      await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app/baselines')
      await expect
        .element(strip().getByRole('tab', { name: 'Baselines' }))
        .toHaveAttribute('aria-selected', 'true')
      await strip().getByRole('tab', { name: 'Sites' }).click()
      await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app/sites')
      await strip().getByRole('tab', { name: 'Triage' }).click()
      await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app/triage')
      await strip().getByRole('tab', { name: 'Builds' }).click()
      await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app')
    })

    it('leave out Sites for a project that has none', async () => {
      await page.viewport(390, 844)
      await renderShell('/acme/api')
      await expect.poll(() => strip().getByRole('tab').elements().length).toBe(3)
      expect(strip().getByRole('tab', { name: 'Sites' }).elements()).toHaveLength(0)
    })

    it('are not on other pages: a build, project settings, Inbox', async () => {
      await page.viewport(390, 844)
      await renderShell('/acme/web-app/settings')
      await expect.element(page.getByRole('main')).toHaveTextContent('Project settings page')
      expect(strip().elements()).toHaveLength(0)
    })

    it('are not on the Inbox', async () => {
      await page.viewport(390, 844)
      await renderShell('/inbox')
      await expect.element(page.getByRole('main')).toHaveTextContent('Inbox page')
      expect(strip().elements()).toHaveLength(0)
    })

    it('are not on a wide screen, where the sidebar has the sub-items', async () => {
      await page.viewport(1280, 800)
      await renderShell('/acme/web-app/triage')
      await expect.element(page.getByRole('main')).toHaveTextContent('Triage page')
      expect(strip().elements()).toHaveLength(0)
      await expect
        .element(
          page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Baselines/ }),
        )
        .toBeVisible()
    })
  })

  it('leaves the desktop header without the phone buttons', async () => {
    await page.viewport(1280, 800)
    await renderShell('/headed')
    await expect.element(page.getByRole('main')).toBeVisible()
    expect(headerButton('Search')).toBeUndefined()
    expect(headerButton('Settings sections')).toBeUndefined()
  })

  it('keeps the desktop sidebar: Main navigation with the workspace, the projects and the hide button', async () => {
    await page.viewport(1280, 800)
    await renderShell('/inbox')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect.element(nav).toBeVisible()
    await expect.element(nav.getByRole('button', { name: 'Workspace: Acme' })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: /^web-app/ })).toBeVisible()
    await expect.element(hide()).toBeVisible()
    expect(page.getByRole('navigation', { name: 'Pages' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'More' }).elements()).toHaveLength(0)
  })

  it('keeps the desktop settings navigation, with its Back link and no sections button', async () => {
    await page.viewport(1280, 800)
    await renderShell('/workspaces/acme/settings')
    const nav = page.getByRole('navigation', { name: 'Settings' })
    await expect.element(nav.getByRole('link', { name: 'Back to Inbox' })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'Members' })).toBeVisible()
    expect(headerButton('Settings sections')).toBeUndefined()
  })
})

const show = () => page.getByRole('button', { name: 'Show sidebar' })
const hide = () => page.getByRole('button', { name: 'Hide sidebar' })

describe('Shell, collapsing the navigation', () => {
  it('hides the sidebar with its button, leaves a Show sidebar icon left of the breadcrumb and keeps it', async () => {
    await page.viewport(1280, 800)
    await renderShell('/headed')
    expect(show().elements()).toHaveLength(0)
    // Open, the toggle is the page header's first control, in the panel, where Show will be.
    const main = page.getByRole('main').element()
    expect(main.contains(hide().element())).toBe(true)
    expect(
      page.getByRole('navigation', { name: 'Main' }).element().contains(hide().element()),
    ).toBe(false)
    const before = hide().element().getBoundingClientRect()
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
    // Hide and Show sit at the same height in the header's left end.
    expect(Math.abs(icon.top - before.top)).toBeLessThan(2)
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

  it('has no sidebar buttons below 820px, and no handle', async () => {
    await page.viewport(700, 800)
    usePaneStore.getState().setCollapsed('sidebar', true)
    await renderShell('/headed')
    await expect.element(page.getByRole('button', { name: 'Search' })).toBeVisible()
    expect(page.getByRole('button', { name: 'Open navigation' }).elements()).toHaveLength(0)
    expect(page.getByRole('separator').elements()).toHaveLength(0)
    expect(show().elements()).toHaveLength(0)
  })
})

const tabs = () => page.getByRole('navigation', { name: 'Pages' })

/** The tabs of a project's pages, under the page header. */
const strip = () => page.getByRole('tablist', { name: 'Project pages' })

/** The project tiles in the Projects tab's icon. */
const tiles = () =>
  tabs()
    .getByRole('button', { name: /^(Projects|web-app)/ })
    .element()
    .querySelectorAll('svg[data-avatar="marble"]')

describe('Shell, phone', () => {
  it('has a bottom tab bar with the counts, 44px targets and room for the home indicator', async () => {
    await page.viewport(390, 844)
    await renderShell('/inbox')
    await expect.element(tabs()).toBeVisible()
    // Reviews is a link once the sidebar model says which workspace. No Triage: a project's
    // Triage is one of its page icons beside the find field.
    await expect.poll(() => tabs().getByRole('link').elements().length).toBe(2)
    const names = tabs()
      .getByRole('link')
      .elements()
      .map((el) => el.textContent)
    expect(names).toEqual(['3Inbox, 3 unread', '2Reviews, 2 waiting'])
    expect(tabs().getByText('Triage').elements()).toHaveLength(0)
    // Projects opens a sheet, like More.
    await expect.element(tabs().getByRole('button', { name: 'Projects' })).toBeVisible()
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

  it('moves between Inbox and Reviews without a reload', async () => {
    await page.viewport(390, 844)
    const { router } = await renderShell('/inbox')
    await expect.poll(() => tabs().getByRole('link').elements().length).toBe(2)
    await tabs()
      .getByRole('link', { name: /^Reviews/ })
      .click()
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/acme/reviews')
    await expect
      .element(tabs().getByRole('link', { name: /^Reviews/ }))
      .toHaveAttribute('aria-current', 'page')
  })

  it("puts a project's pages as icons beside its find field, and they open those pages", async () => {
    await page.viewport(390, 844)
    const { router } = await renderShell('/acme/web-app')
    const pages = page.getByRole('tablist', { name: 'Project pages' })
    await expect.element(pages).toBeVisible()
    // Icons, named for their pages.
    const names = pages
      .getByRole('tab')
      .elements()
      .map((el) => el.textContent)
    expect(names).toEqual(['Builds', 'Triage', 'Baselines'])
    for (const tab of pages.getByRole('tab').elements()) {
      expect(tab.querySelector('svg')).not.toBeNull()
    }
    await expect
      .element(pages.getByRole('tab', { name: 'Builds' }))
      .toHaveAttribute('aria-selected', 'true')
    await pages.getByRole('tab', { name: 'Triage' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app/triage')
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

  it("draws Reviews in the bottom bar with the design's check in a circle", async () => {
    await page.viewport(390, 844)
    await renderShell('/inbox')
    const reviews = tabs().getByRole('link', { name: /^Reviews/ })
    await expect.element(reviews).toBeVisible()
    expect(reviews.element().querySelector('svg.lucide-circle-check-big')).not.toBeNull()
  })

  it('opens More as a menu with Insights, the views and the settings entries, and closes it on a choice', async () => {
    await page.viewport(390, 844)
    const { router } = await renderShell('/acme/web-app/triage')
    await tabs().getByRole('button', { name: 'More' }).click()
    const menu = page.getByRole('menu')
    await expect.element(menu).toBeVisible()
    const rows = menu
      .getByRole('menuitem')
      .elements()
      .map((el) => el.textContent?.trim())
    // The projects are in the Projects tab's menu, and Baselines and Sites in the project page's tabs.
    expect(rows.slice(-4)).toEqual(['Insights', 'Failing on main', 'Settings', 'Sign out'])
    for (const row of menu.getByRole('menuitem').elements()) {
      expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(36)
    }
    await menu.getByRole('menuitem', { name: 'Insights' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/acme/insights')
    await expect.poll(() => page.getByRole('menu').elements().length).toBe(0)
    // On Insights the More tab shows as selected.
    await expect
      .element(tabs().getByRole('button', { name: 'More' }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('has one Settings entry in More, and settings is left only by its Close', async () => {
    await page.viewport(390, 844)
    const { router } = await renderShell('/inbox')
    await tabs().getByRole('button', { name: 'More' }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: 'Settings' }).click()
    await expect.poll(() => router.state.location.pathname).toMatch(/^\/workspaces\/acme\/settings/)
    // Settings has its own navigation: no tab bar, a Close in the header, the list in a sheet.
    expect(tabs().elements()).toHaveLength(0)
    await page.getByRole('button', { name: 'Settings sections' }).click()
    const sections = page.getByRole('dialog', { name: 'Settings sections' })
    await expect.element(sections.getByRole('link', { name: 'Profile' })).toBeVisible()
    await expect.element(sections.getByRole('link', { name: 'General' }).first()).toBeVisible()
    expect(sections.getByRole('link', { name: /^Back to/ }).elements()).toHaveLength(0)
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
