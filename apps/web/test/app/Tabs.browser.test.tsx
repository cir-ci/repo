import { CirciTheme, ContextMenu } from '@circi/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useNavigate,
} from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it (nothing here talks to a server).
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { Shell } from '#app/Shell.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { PageHeading } from '#lib/PageHeading.tsx'
import { openInNewTabItem } from '#lib/row-menu.ts'
import { useTabStore } from '#lib/stores/tab-store.ts'
import { hrefOf } from '#lib/tabs.ts'
import { ToastHost } from '#lib/ToastHost.tsx'
import { mockAuthClient } from '#test/support/auth-client.ts'

const API: Record<string, unknown> = {
  '/api/workspaces/acme/sidebar': {
    teams: [
      {
        slug: 'web-app',
        name: 'web-app',
        pinned: true,
        triage: 0,
        siteCount: 0,
        color: 'slate',
        icon: null,
      },
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

/** Runs the dashboard as the installed app (or in a browser tab) by faking the display-mode media queries. */
function installedAs(mode: 'browser' | 'standalone' | 'overlay') {
  const real = window.matchMedia.bind(window)
  vi.stubGlobal('matchMedia', (query: string) => {
    if (!query.includes('display-mode')) return real(query)
    const overlayOnly = query.includes('window-controls-overlay') && !query.includes('standalone')
    const matches = mode === 'browser' ? false : overlayOnly ? mode === 'overlay' : true
    return Object.create(real(query), { matches: { value: matches } })
  })
}

/** A page: a header, a title for the document, and buttons that go elsewhere through the router. */
function Page({ name, go }: { name: string; go?: Record<string, string> }) {
  const navigate = useNavigate()
  useDocumentTitle(name)
  return (
    <>
      <PageHeading title={name} />
      {Object.entries(go ?? {}).map(([label, href]) => (
        <button key={label} type="button" onClick={() => void navigate({ href })}>
          {label}
        </button>
      ))}
      <a href="/inbox">Inbox link</a>
      <ContextMenu items={[openInNewTabItem('/account/profile')]}>
        <p>Row with a menu</p>
      </ContextMenu>
    </>
  )
}

async function renderApp(path = '/') {
  const root = createRootRoute({ component: Shell })
  const pageRoute = (route: string, name: string, go?: Record<string, string>) =>
    createRoute({
      getParentRoute: () => root,
      path: route,
      component: () => <Page name={name} {...(go ? { go } : {})} />,
    })
  const router = createRouter({
    routeTree: root.addChildren([
      pageRoute('/', 'Teams page', {
        'Go to profile': '/account/profile',
        'Go to members': '/inbox',
      }),
      pageRoute('account/profile', 'Profile page', { 'Go to instance': '/instance/accounts' }),
      pageRoute('instance/accounts', 'Accounts page'),
      pageRoute('inbox', 'Inbox page'),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(
    <CirciTheme>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <ToastHost />
      </QueryClientProvider>
    </CirciTheme>,
  )
  return router
}

const tabs = () => page.getByRole('tab')
const tabNamed = (name: string) => page.getByRole('tab', { name })
const press = (keys: string) => userEvent.keyboard(keys)
const store = () => useTabStore.getState()

mockAuthClient()

beforeEach(async () => {
  await page.viewport(1280, 800)
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
        .pathname
      const body = API[path]
      return Promise.resolve(
        new Response(JSON.stringify(body ?? { error: 'not found' }), {
          status: body === undefined ? 404 : 200,
        }),
      )
    }),
  )
})

describe('tabs in a normal browser tab', () => {
  it('show nothing and leave the keys alone', async () => {
    installedAs('browser')
    await renderApp()
    await expect.element(page.getByRole('main')).toHaveTextContent('Teams page')
    expect(tabs().elements()).toHaveLength(0)
    await press('{Alt>}t{/Alt}')
    expect(store().tabs).toHaveLength(0)
    // The page keeps its title with the app's name, and the menu item still opens a browser tab.
    expect(document.title).toBe('Teams page · CirCI')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await page.getByText('Row with a menu').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open in new tab' }).click()
    expect(open).toHaveBeenCalledOnce()
    expect(store().tabs).toHaveLength(0)
  })
})

describe('tabs in the installed app', () => {
  it('shows a strip with the page as the one tab', async () => {
    installedAs('standalone')
    await renderApp()
    await expect.element(tabNamed('Teams page')).toBeVisible()
    expect(tabs().elements()).toHaveLength(1)
    await expect.element(page.getByRole('button', { name: 'New tab' })).toBeVisible()
  })

  it('puts the strip in the frame (below it everything sticks) unless the title bar has it', async () => {
    installedAs('standalone')
    await renderApp()
    await expect.element(tabNamed('Teams page')).toBeVisible()
    expect(document.documentElement.style.getPropertyValue('--circi-window-top')).toBe('36px')
  })

  it('leaves the frame without a row in overlay mode, where the title bar carries the tabs', async () => {
    installedAs('overlay')
    await renderApp()
    await expect.element(tabNamed('Teams page')).toBeVisible()
    expect(document.documentElement.style.getPropertyValue('--circi-window-top')).toBe('')
  })

  it('opens a tab from the menu, and each tab keeps its own page', async () => {
    installedAs('standalone')
    await renderApp()
    await page.getByRole('button', { name: 'Go to profile' }).click()
    await expect.element(tabNamed('Profile page')).toBeVisible()
    await page.getByText('Row with a menu').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open in new tab' }).click()
    expect(tabs().elements()).toHaveLength(2)
    // It opens behind the page being read.
    await expect.element(page.getByRole('main')).toHaveTextContent('Profile page')
    await page.getByRole('button', { name: 'New tab' }).click()
    await expect.element(page.getByRole('main')).toHaveTextContent('Inbox page')
    await tabNamed('Profile page').first().click()
    await expect.element(page.getByRole('main')).toHaveTextContent('Profile page')
  })

  it('opens a link in a background tab on ⌘-click and on middle-click', async () => {
    installedAs('standalone')
    await renderApp()
    const link = page.getByRole('link', { name: 'Inbox link' }).element()
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }))
    expect(
      store()
        .tabs.map((t) => hrefOf(t))
        .toSorted(),
    ).toEqual(['/', '/inbox'])
    link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))
    expect(store().tabs).toHaveLength(3)
    await expect.element(page.getByRole('main')).toHaveTextContent('Teams page')
  })

  it('keeps back inside the tab', async () => {
    installedAs('standalone')
    const router = await renderApp()
    await page.getByRole('button', { name: 'Go to profile' }).click()
    await expect.element(page.getByRole('main')).toHaveTextContent('Profile page')
    await press('{Alt>}t{/Alt}')
    await expect.element(page.getByRole('main')).toHaveTextContent('Inbox page')
    // Back in the new tab has nowhere to go but the tab it was opened from.
    router.history.back()
    await expect.element(page.getByRole('main')).toHaveTextContent('Profile page')
    expect(tabs().elements()).toHaveLength(1)
    // Back in the first tab walks its own pages.
    router.history.back()
    await expect.element(page.getByRole('main')).toHaveTextContent('Teams page')
  })

  it('answers the shortcuts', async () => {
    installedAs('standalone')
    await renderApp()
    await press('{Alt>}t{/Alt}')
    await press('{Alt>}t{/Alt}')
    expect(tabs().elements()).toHaveLength(3)
    await press('{Alt>}1{/Alt}')
    expect(store().tabs[0]?.id).toBe(store().activeId)
    await press('{Alt>}{ArrowRight}{/Alt}')
    expect(store().tabs[1]?.id).toBe(store().activeId)
    await press('{Alt>}p{/Alt}')
    expect(store().tabs.filter((t) => t.pinned)).toHaveLength(1)
    await press('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}')
    await press('{Alt>}9{/Alt}')
    expect(store().tabs.at(-1)?.id).toBe(store().activeId)
    await press('{Alt>}w{/Alt}')
    expect(tabs().elements()).toHaveLength(2)
    await press('{Meta>}{Shift>}t{/Shift}{/Meta}')
    expect(tabs().elements()).toHaveLength(3)
  })

  it('lists the tab shortcuts in the help only when installed', async () => {
    installedAs('standalone')
    await renderApp()
    await press('?')
    await expect.element(page.getByText('Pin or unpin the tab')).toBeVisible()
  })

  it('closes the oldest unpinned background tab at 12 tabs, and Undo brings it back', async () => {
    installedAs('standalone')
    await renderApp()
    for (let i = 0; i < 11; i++) store().openNew()
    await expect.element(tabs().nth(11)).toBeVisible()
    expect(tabs().elements()).toHaveLength(12)
    await press('{Alt>}t{/Alt}')
    expect(tabs().elements()).toHaveLength(12)
    await expect.element(page.getByText('to stay within 12 tabs')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.element(tabNamed('Teams page')).toBeVisible()
    expect(tabs().elements()).toHaveLength(12)
  })

  it('saves the tabs, so a restart finds them', async () => {
    installedAs('standalone')
    await renderApp()
    await press('{Alt>}t{/Alt}')
    const saved = JSON.parse(localStorage.getItem('circi-tabs') ?? 'null')
    expect(saved.state.tabs).toHaveLength(2)
  })
})
