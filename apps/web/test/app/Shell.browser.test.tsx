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
import { page } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it (nothing here talks to a server).
const auth = vi.hoisted(() => ({
  user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.test' } as {
    id: string
    name: string
    email: string
  } | null,
  signOut: vi.fn<() => Promise<void>>(),
}))
vi.mock('../../src/lib/auth-client.ts', () => ({
  authClient: {
    useSession: () => ({ data: auth.user ? { user: auth.user } : null, isPending: false }),
    signOut: auth.signOut,
    $store: { notify: () => {} },
    organization: { getInvitation: async () => ({ data: null, error: new Error('none') }) },
  },
}))

import { Shell } from '../../src/app/Shell.tsx'

const overview = (org: string, orgName: string, project: string) => ({
  org: { slug: org, name: orgName },
  project: { slug: project, name: project, defaultBranch: 'main' },
  latestBuild: null,
})

// The data API is the other edge: answers by path.
const API: Record<string, unknown> = {
  '/api/projects': {
    projects: [
      overview('acme', 'Acme', 'web-app'),
      overview('acme', 'Acme', 'storybook'),
      overview('globex', 'Globex', 'portal'),
    ],
  },
  '/api/capabilities': {
    canCreateOrganization: false,
    manageableOrganizations: [],
    refusingOrganizations: [],
  },
  '/api/instance/notices': {},
  '/api/setup': { needed: false },
  '/api/auth-methods': { password: true, email: false, sso: [] },
}

const text = (content: string) => () => <p>{content}</p>

async function renderShell(path: string) {
  const root = createRootRoute({ component: Shell })
  const routes = [
    createRoute({ getParentRoute: () => root, path: '/', component: text('Projects page') }),
    createRoute({ getParentRoute: () => root, path: 'account', component: text('Account page') }),
    createRoute({
      getParentRoute: () => root,
      path: 'organizations/$org/members',
      component: text('Members page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: '$org/$project',
      component: text('Builds page'),
    }),
    createRoute({
      getParentRoute: () => root,
      path: '$org/$project/sites',
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
  it('shows the sidebar navigation, the org’s projects and the page in the panel', async () => {
    await page.viewport(1280, 800)
    await renderShell('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect.element(nav).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'Projects', exact: true })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'Members' })).toBeVisible()
    // The organization of the first project (alphabetical: Acme), its projects alphabetically.
    await expect.element(nav.getByRole('link', { name: 'storybook' })).toBeVisible()
    await expect.element(nav.getByRole('link', { name: 'web-app' })).toBeVisible()
    expect(nav.getByRole('link', { name: 'portal' }).elements()).toHaveLength(0)
    await expect.element(page.getByRole('main')).toHaveTextContent('Projects page')
  })

  it('marks the current page with aria-current', async () => {
    await page.viewport(1280, 800)
    await renderShell('/organizations/acme/members')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect
      .element(nav.getByRole('link', { name: 'Members' }))
      .toHaveAttribute('aria-current', 'page')
    await expect
      .element(nav.getByRole('link', { name: 'Projects', exact: true }))
      .not.toHaveAttribute('aria-current')
  })

  it('opens the project’s pages under it and marks the open one', async () => {
    await page.viewport(1280, 800)
    await renderShell('/acme/web-app/sites')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect
      .element(nav.getByRole('link', { name: 'Sites' }))
      .toHaveAttribute('aria-current', 'page')
    await expect.element(nav.getByRole('link', { name: 'Settings' })).toBeVisible()
  })

  it('navigates without a page reload', async () => {
    await page.viewport(1280, 800)
    const { router } = await renderShell('/')
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Members' })
      .click()
    await expect.element(page.getByRole('main')).toHaveTextContent('Members page')
    expect(router.state.location.pathname).toBe('/organizations/acme/members')
  })

  it('lists the organizations in the switcher and follows the one chosen', async () => {
    await page.viewport(1280, 800)
    const { router } = await renderShell('/acme/web-app')
    const trigger = page.getByRole('button', { name: 'Organization: Acme' })
    await trigger.click()
    expect(page.getByRole('menuitem').elements()).toHaveLength(2)
    await page.getByRole('menuitem', { name: 'Globex' }).click()
    await expect.element(page.getByRole('button', { name: 'Organization: Globex' })).toBeVisible()
    await expect
      .element(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'portal' }))
      .toBeVisible()
    expect(router.state.location.pathname).toBe('/')
  })

  it('still shows the name when there is only one organization', async () => {
    await page.viewport(1280, 800)
    API['/api/projects'] = { projects: [overview('acme', 'Acme', 'web-app')] }
    try {
      await renderShell('/')
      await expect.element(page.getByRole('button', { name: 'Organization: Acme' })).toBeVisible()
    } finally {
      API['/api/projects'] = {
        projects: [
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
    await renderShell('/organizations/acme/members')
    expect(page.getByRole('navigation', { name: 'Main' }).elements()).toHaveLength(0)
    await expect.element(page.getByText('Members').first()).toBeVisible()
    await page.getByRole('button', { name: 'Open navigation' }).click()
    const drawer = page.getByRole('dialog', { name: 'Navigation' })
    await expect.element(drawer).toBeVisible()
    await expect
      .element(drawer.getByRole('link', { name: 'Members' }))
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
