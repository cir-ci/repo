import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { createAppRouter, PENDING } from '#app/router.tsx'
import { PageSkeleton } from '#lib/PageSkeleton.tsx'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A router with the app's pending settings and a page whose code takes `loadMs` to arrive. */
function appWithSlowPage(loadMs: number) {
  const root = createRootRoute({ component: () => <Outlet /> })
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <h1>Home</h1>,
  })
  const slow = createRoute({
    getParentRoute: () => root,
    path: '/slow',
    component: lazyRouteComponent(async () => {
      await wait(loadMs)
      return { SlowPage: () => <h1>Slow page</h1> }
    }, 'SlowPage'),
  })
  return createRouter({
    routeTree: root.addChildren([home, slow]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    ...PENDING,
  })
}

const skeleton = () => document.querySelector('[data-slot="page-skeleton"]')

describe('a lazily loaded page', () => {
  it("is the app router's pending page for every route", () => {
    const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ['/'] }) })
    expect(router.options.defaultPendingComponent).toBe(PageSkeleton)
    expect(router.options.defaultPendingMs).toBe(300)
  })

  it('keeps the current page while a slow page loads, then shows the skeleton, then the page', async () => {
    const router = appWithSlowPage(800)
    await render(<RouterProvider router={router} />)
    await expect.element(page.getByRole('heading', { name: 'Home' })).toBeVisible()
    void router.navigate({ href: '/slow' })
    await wait(100)
    // Under 300ms: still the old page, no skeleton (nothing flashes).
    expect(skeleton()).toBeNull()
    await expect.element(page.getByRole('heading', { name: 'Home' })).toBeVisible()
    // After it: the skeleton, in place of the page.
    await expect.poll(skeleton, { timeout: 2000 }).not.toBeNull()
    await expect.element(page.getByRole('heading', { name: 'Slow page' })).toBeVisible()
    expect(skeleton()).toBeNull()
  })

  it('shows no skeleton at all for a page that loads quickly', async () => {
    const router = appWithSlowPage(50)
    await render(<RouterProvider router={router} />)
    await expect.element(page.getByRole('heading', { name: 'Home' })).toBeVisible()
    let seen = false
    const watch = setInterval(() => {
      if (skeleton()) seen = true
    }, 10)
    await router.navigate({ href: '/slow' })
    await expect.element(page.getByRole('heading', { name: 'Slow page' })).toBeVisible()
    clearInterval(watch)
    expect(seen).toBe(false)
  })
})
