import { AppFrame, CirciTheme } from '@circi/ui'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { SCROLL } from '#app/router.tsx'
import { pageScroller, pageScrollTop, scrollPageTo } from '#lib/page-scroller.ts'

const Long = () => <div style={{ height: 3000, flexShrink: 0 }}>Long page</div>

async function open(width: number, height: number) {
  await page.viewport(width, height)
  const root = createRootRoute({
    component: () => (
      <AppFrame sidebar="Side" compact>
        <Outlet />
      </AppFrame>
    ),
  })
  const route = (path: string) => createRoute({ getParentRoute: () => root, path, component: Long })
  const router = createRouter({
    routeTree: root.addChildren([route('/a'), route('/b')]),
    history: createMemoryHistory({ initialEntries: ['/a'] }),
    ...SCROLL,
  })
  await render(
    <CirciTheme>
      <RouterProvider router={router} />
    </CirciTheme>,
  )
  await expect.element(page.getByText('Long page')).toBeVisible()
  return router
}

describe('the page scroller', () => {
  it('is the panel on a phone', async () => {
    await open(390, 844)
    expect(pageScroller()).toBe(document.getElementById('content'))
    scrollPageTo(300)
    await expect.poll(pageScrollTop).toBe(300)
    expect(window.scrollY).toBe(0)
  })

  it('is the window at 1280px', async () => {
    await open(1280, 700)
    expect(pageScroller()).toBe(window)
    scrollPageTo(300)
    await expect.poll(() => window.scrollY).toBe(300)
    expect(pageScrollTop()).toBe(300)
  })
})

describe('the router scrolling', () => {
  it('starts a new page at the top of the panel on a phone, and puts the panel back on back', async () => {
    const router = await open(390, 844)
    const panel = document.getElementById('content')!
    panel.scrollTo({ top: 600 })
    await expect.poll(() => panel.scrollTop).toBe(600)
    // The router notes the scroll from its event, which the browser fires on the next frame.
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    await router.navigate({ href: '/b' })
    await expect.poll(() => panel.scrollTop).toBe(0)
    router.history.back()
    await expect.poll(() => panel.scrollTop).toBe(600)
    expect(window.scrollY).toBe(0)
  })

  it('still starts a new page at the top of the window at 1280px', async () => {
    const router = await open(1280, 700)
    window.scrollTo(0, 600)
    await expect.poll(() => window.scrollY).toBe(600)
    await router.navigate({ href: '/b' })
    await expect.poll(() => window.scrollY).toBe(0)
  })
})
