import { ContextMenu } from '@circi/ui'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { Shell } from '#app/Shell.tsx'
import { clipboard } from '#lib/clipboard.ts'
import { PageHeading } from '#lib/PageHeading.tsx'
import { mockAuthClient } from '#test/support/auth-client.ts'
import { fakeFetch, getRoutes } from '#test/support/fetch.ts'
import { menuItemNames } from '#test/support/menu.ts'
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

function Content() {
  return (
    <>
      <PageHeading title="Projects page" />
      <p>Plain text</p>
      <input aria-label="Name" />
      <ContextMenu items={[{ label: 'Row action' }]}>
        <p>Row with a menu</p>
      </ContextMenu>
    </>
  )
}

async function renderApp() {
  const root = createRootRoute({ component: Shell })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: Content }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await renderPage(null, { router })
  await expect.element(page.getByRole('heading', { name: 'Projects page' })).toBeVisible()
}

/** A right click as the browser sends it, to see whether the app took it over. */
function rightClick(el: Element): MouseEvent {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 300,
    clientY: 300,
  })
  el.dispatchEvent(event)
  return event
}

mockAuthClient()

beforeEach(async () => {
  await page.viewport(1280, 800)
  fakeFetch(getRoutes(API))
})

describe('the app-level context menu', () => {
  it('opens on a right click over empty space, with the page actions', async () => {
    await renderApp()
    await page.getByText('Plain text').click({ button: 'right' })
    await expect.element(page.getByRole('menuitem', { name: 'Reload' })).toBeVisible()
    expect(menuItemNames()).toEqual([
      'Back',
      'Forward',
      'Reload',
      'Copy link',
      'Search…⌘K',
      'Keyboard shortcuts?',
    ])
  })

  it("leaves a row's own menu in charge", async () => {
    await renderApp()
    await page.getByText('Row with a menu').click({ button: 'right' })
    await expect.element(page.getByRole('menuitem', { name: 'Row action' })).toBeVisible()
    expect(menuItemNames()).toEqual(['Row action'])
  })

  it('keeps the browser menu in text fields and over images', async () => {
    await renderApp()
    const input = page.getByRole('textbox', { name: 'Name' }).element()
    expect(rightClick(input).defaultPrevented).toBe(false)
    const image = document.createElement('img')
    document.body.append(image)
    expect(rightClick(image).defaultPrevented).toBe(false)
    image.remove()
    expect(menuItemNames()).toEqual([])
  })

  it('offers Copy when text is selected', async () => {
    await renderApp()
    const text = page.getByText('Plain text').element()
    window.getSelection()?.selectAllChildren(text)
    await page.getByText('Plain text').click({ button: 'right' })
    await expect.element(page.getByRole('menuitem', { name: 'Copy', exact: true })).toBeVisible()
  })

  it("copies the current page's address with Copy link", async () => {
    await renderApp()
    const write = vi.spyOn(clipboard, 'write').mockResolvedValue()
    await page.getByText('Plain text').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Copy link' }).click()
    await expect.poll(() => write).toHaveBeenCalledWith(window.location.href)
    await expect.element(page.getByText('Link copied')).toBeVisible()
  })

  it('is not there on a phone, where a long press is scrolling', async () => {
    await page.viewport(390, 800)
    await renderApp()
    expect(rightClick(page.getByText('Plain text').element()).defaultPrevented).toBe(false)
  })
})
