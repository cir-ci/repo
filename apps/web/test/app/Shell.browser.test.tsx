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
const auth = vi.hoisted(() => ({
  user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.test' } as {
    id: string
    name: string
    email: string
  } | null,
  signOut: vi.fn<() => Promise<void>>(),
}))
vi.mock('#lib/auth-client.ts', () => ({
  authClient: {
    useSession: () => ({ data: auth.user ? { user: auth.user } : null, isPending: false }),
    signOut: auth.signOut,
    $store: { notify: () => {} },
    organization: { getInvitation: async () => ({ data: null, error: new Error('none') }) },
  },
}))

import { Shell } from '#app/Shell.tsx'

const overview = (workspace: string, workspaceName: string, team: string) => ({
  workspace: { slug: workspace, name: workspaceName },
  team: { slug: team, name: team, defaultBranch: 'main' },
  latestBuild: null,
})

// The data API is the other edge: answers by path.
const API: Record<string, unknown> = {
  '/api/teams': {
    teams: [
      overview('acme', 'Acme', 'web-app'),
      overview('acme', 'Acme', 'storybook'),
      overview('globex', 'Globex', 'portal'),
    ],
  },
  '/api/workspaces/acme/sidebar': {
    teams: [
      { slug: 'web-app', name: 'web-app', pinned: true, triage: 4 },
      { slug: 'storybook', name: 'storybook', pinned: false, triage: 0 },
      { slug: 'api', name: 'api', pinned: false, triage: 0 },
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
  },
  '/api/workspaces/globex/sidebar': {
    teams: [{ slug: 'portal', name: 'portal', pinned: false, triage: 0 }],
    views: [],
    inboxUnread: 0,
    reviews: 0,
  },
  '/api/capabilities': {
    canCreateWorkspace: false,
    manageableWorkspaces: [],
    refusingWorkspaces: [],
  },
  '/api/instance/notices': {},
  '/api/setup': { needed: false },
  '/api/auth-methods': { password: true, email: false, sso: [] },
}

const text = (content: string) => () => <p>{content}</p>

async function renderShell(path: string) {
  const root = createRootRoute({ component: Shell })
  const routes = [
    createRoute({ getParentRoute: () => root, path: '/', component: text('Teams page') }),
    createRoute({ getParentRoute: () => root, path: 'account', component: text('Account page') }),
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

beforeEach(() => {
  auth.user = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.test' }
  auth.signOut.mockReset().mockResolvedValue(undefined)
  localStorage.clear()
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
    await expect.element(nav.getByRole('link', { name: 'Settings' })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'storybook' })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'web-app' })).toBeVisible()
    expect(nav.getByRole('link', { name: 'portal' }).elements()).toHaveLength(0)
    await expect.element(page.getByRole('main')).toHaveTextContent('Teams page')
  })

  it('shows the Inbox and Reviews counts and the pinned views', async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect.element(nav.getByRole('link', { name: 'Inbox , 3 unread' })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'Reviews , 2 waiting' })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'Failing on main' })).toBeVisible()
    expect(nav.getByRole('link', { name: 'Not pinned' }).elements()).toHaveLength(0)
  })

  it('lists pinned teams first, then the rest A to Z', async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect.element(nav.getByRole('link', { name: 'api' })).toBeVisible()
    const names = nav
      .getByRole('region', { name: 'Teams' })
      .getByRole('link')
      .elements()
      .map((el) => el.textContent)
    expect(names).toEqual(['web-app', 'api', 'storybook'])
  })

  it('marks the current page with aria-current', async () => {
    await page.viewport(1280, 800)
    await renderShell('/workspaces/acme/reviews')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect
      .element(nav.getByRole('link', { name: 'Reviews , 2 waiting' }))
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
      .element(nav.getByRole('link', { name: 'Triage , 4 waiting' }))
      .toHaveAttribute('aria-current', 'page')
    await expect.element(nav.getByRole('link', { name: 'Builds' })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'Baselines' })).toBeVisible()
    // Settings twice: the top-level entry and the team's.
    expect(nav.getByRole('link', { name: 'Settings' }).elements()).toHaveLength(2)
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
    expect(page.getByRole('menuitem').elements()).toHaveLength(2)
    await page.getByRole('menuitem', { name: 'Globex' }).click()
    await expect.element(page.getByRole('button', { name: 'Workspace: Globex' })).toBeVisible()
    await expect
      .element(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'portal' }))
      .toBeVisible()
    expect(router.state.location.pathname).toBe('/')
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
    await expect.element(page.getByRole('menuitem', { name: 'Account' })).toBeVisible()
    await expect.element(page.getByRole('group', { name: 'Theme' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect.poll(() => auth.signOut.mock.calls.length).toBe(1)
    // Everything fetched as this person is forgotten.
    await expect.poll(() => queryClient.getQueryData(['marker'])).toBeUndefined()
  })

  it('goes to the account page from the user menu', async () => {
    await page.viewport(1280, 800)
    const { router } = await renderShell('/')
    await page.getByRole('button', { name: 'Account menu for Ada Lovelace' }).click()
    await page.getByRole('menuitem', { name: 'Account' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/account')
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
        page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'web-app' }),
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
  it('shows the sectioned settings nav on the members page, which sits inside it', async () => {
    await page.viewport(1280, 800)
    await renderShell('/workspaces/acme/settings/members')
    const nav = page.getByRole('navigation', { name: 'Settings' })
    await expect.element(nav).toBeVisible()
    await expect.element(nav.getByRole('region', { name: 'Account' })).toBeVisible()
    await expect.element(nav.getByRole('region', { name: 'Workspace · Acme' })).toBeVisible()
    await expect
      .element(nav.getByRole('link', { name: 'Members' }))
      .toHaveAttribute('aria-current', 'page')
    await expect.element(page.getByText('Members page')).toBeVisible()
    expect(nav.getByRole('region', { name: /^Team/ }).elements()).toHaveLength(0)
  })

  it('shares the nav with the account page, and adds the team section on a team’s', async () => {
    await page.viewport(1280, 800)
    const { router } = await renderShell('/account')
    const nav = page.getByRole('navigation', { name: 'Settings' })
    await expect
      .element(nav.getByRole('link', { name: 'Profile' }))
      .toHaveAttribute('aria-current', 'page')
    await router.navigate({
      to: '/$workspace/$team/settings',
      params: { workspace: 'acme', team: 'web-app' },
    })
    await expect.element(nav.getByRole('region', { name: 'Team · web-app' })).toBeVisible()
    await expect
      .element(nav.getByRole('link', { name: 'General' }).last())
      .toHaveAttribute('aria-current', 'page')
  })

  it('has no settings nav on other pages', async () => {
    await page.viewport(1280, 800)
    await renderShell('/inbox')
    await expect.element(page.getByRole('main')).toHaveTextContent('Inbox page')
    expect(page.getByRole('navigation', { name: 'Settings' }).elements()).toHaveLength(0)
  })
})

describe('Shell, outside the dashboard', () => {
  it('shows the sign-in page, without the sidebar, when nobody is signed in', async () => {
    await page.viewport(1280, 800)
    auth.user = null
    await renderShell('/')
    await expect.element(page.getByRole('heading', { name: 'Sign in to CirCI' })).toBeVisible()
    expect(page.getByRole('navigation', { name: 'Main' }).elements()).toHaveLength(0)
  })

  it('shows the site handoff without the sidebar', async () => {
    await page.viewport(1280, 800)
    await renderShell('/_sso/site')
    await expect.element(page.getByRole('main')).toHaveTextContent('Handoff page')
    expect(page.getByRole('navigation', { name: 'Main' }).elements()).toHaveLength(0)
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
      .element(drawer.getByRole('link', { name: 'Reviews , 2 waiting' }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('closes the drawer once a page is chosen', async () => {
    await page.viewport(390, 800)
    const { router } = await renderShell('/')
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page
      .getByRole('dialog', { name: 'Navigation' })
      .getByRole('link', { name: 'web-app' })
      .click()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app')
    await expect.poll(() => page.getByRole('dialog').elements().length).toBe(0)
    await expect.element(page.getByRole('main')).toHaveTextContent('Builds page')
  })
})
