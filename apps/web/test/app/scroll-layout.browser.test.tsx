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
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { Shell } from '#app/Shell.tsx'
import { PageHeading } from '#lib/PageHeading.tsx'
import { mockAuthClient } from '#test/support/auth-client.ts'

const API: Record<string, unknown> = {
  '/api/workspaces/acme/sidebar': {
    projects: [],
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

/** Runs the dashboard as the installed app by faking the display-mode media queries. */
function installed() {
  const real = window.matchMedia.bind(window)
  vi.stubGlobal('matchMedia', (query: string) => {
    if (!query.includes('display-mode')) return real(query)
    const overlayOnly = query.includes('window-controls-overlay') && !query.includes('standalone')
    return Object.create(real(query), {
      matches: { value: !overlayOnly },
      addEventListener: { value: () => {} },
      removeEventListener: { value: () => {} },
    })
  })
}

/** Space-taking scrollbars, as on Windows and Linux: headless Chromium draws overlay ones. */
function classicScrollbars() {
  const style = document.createElement('style')
  style.textContent = '*::-webkit-scrollbar { width: 12px; height: 12px }'
  document.head.append(style)
  return style
}

const Long = () => (
  <>
    <PageHeading title="Long page" />
    <div id="body" style={{ height: 100, flexShrink: 0 }}>
      Page body
    </div>
  </>
)

async function renderApp() {
  const root = createRootRoute({ component: Shell })
  const route = createRoute({ getParentRoute: () => root, path: '/', component: Long })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(
    <CirciTheme>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </CirciTheme>,
  )
  await expect.element(page.getByRole('heading', { name: 'Long page' })).toBeVisible()
}

const main = () => document.getElementById('content')!
const header = () => document.querySelector('header')!
const body = () => document.getElementById('body')!
const box = (el: Element) => el.getBoundingClientRect()
const grow = (height: number) => {
  body().style.height = `${height}px`
}

mockAuthClient()

let injected: HTMLStyleElement | undefined

beforeEach(async () => {
  await page.viewport(1280, 800)
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
        .pathname
      const answer = API[path]
      return Promise.resolve(
        new Response(JSON.stringify(answer ?? { error: 'not found' }), {
          status: answer === undefined ? 404 : 200,
        }),
      )
    }),
  )
})

afterEach(() => {
  injected?.remove()
  injected = undefined
  vi.unstubAllGlobals()
})

describe('the installed app on a long page at 1280x800', () => {
  it('starts the scroller under the tab row and the header, and moves neither when it scrolls', async () => {
    installed()
    await renderApp()
    await expect.element(page.getByRole('tab')).toBeVisible()
    grow(3000)
    const row = document.querySelector('[data-tab-row]')!
    expect(box(main()).top).toBeGreaterThanOrEqual(box(row).bottom - 1)
    expect(box(main()).top).toBeGreaterThanOrEqual(box(header()).bottom - 1)
    expect(box(header()).top).toBeGreaterThanOrEqual(box(row).bottom - 1)
    const before = { row: box(row).top, header: box(header()).top }
    main().scrollTo({ top: 500 })
    await expect.poll(() => main().scrollTop).toBe(500)
    expect(box(row).top).toBe(before.row)
    expect(box(header()).top).toBe(before.header)
    expect(window.scrollY).toBe(0)
    expect(document.scrollingElement!.scrollHeight).toBeLessThanOrEqual(window.innerHeight)
  })
})

describe('classic, space-taking scrollbars at 1280x800', () => {
  it('takes the scrollbar inside the scroller, and leaves the header and the content as wide when the page overflows', async () => {
    injected = classicScrollbars()
    await renderApp()
    expect(main().scrollHeight).toBeLessThanOrEqual(main().clientHeight)
    const short = { header: box(header()), content: box(body()).width }
    grow(4000)
    await expect.poll(() => main().scrollHeight).toBeGreaterThan(main().clientHeight)
    // The bar is drawn inside main (its offset width minus its client width), not taken from the header.
    expect(main().offsetWidth - main().clientWidth).toBe(12)
    const long = { header: box(header()), content: box(body()).width }
    expect(long.header.width).toBe(short.header.width)
    expect(long.header.left).toBe(short.header.left)
    expect(long.content).toBe(short.content)
    expect(box(main()).right).toBeLessThanOrEqual(window.innerWidth)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    expect(window.scrollX).toBe(0)
  })
})
