import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { Shell } from '#app/Shell.tsx'
import { PageHeading } from '#lib/PageHeading.tsx'
import { mockAuthClient } from '#test/support/auth-client.ts'
import { installedAs } from '#test/support/display-mode.ts'
import { fakeFetch, getRoutes } from '#test/support/fetch.ts'
import { expectNoSidewaysScroll } from '#test/support/overflow.ts'
import { renderPage } from '#test/support/render.tsx'

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
  await renderPage(null, { router })
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
  fakeFetch(getRoutes(API))
})

afterEach(() => {
  injected?.remove()
  injected = undefined
})

describe('the installed app on a long page at 1280x800', () => {
  it('starts the scroller under the tab row and the header, and moves neither when it scrolls', async () => {
    installedAs('standalone')
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
    expectNoSidewaysScroll()
    expect(window.scrollX).toBe(0)
  })
})
