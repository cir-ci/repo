import { ContextMenu } from '@circi/ui'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
} from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { Shell } from '#app/Shell.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { PageHeading } from '#lib/PageHeading.tsx'
import { openInNewTabItem } from '#lib/row-menu.ts'
import { useTabStore } from '#lib/stores/tab-store.ts'
import { hrefOf } from '#lib/tabs.ts'
import { mockAuthClient } from '#test/support/auth-client.ts'
import { installedAs, switchableDisplayMode } from '#test/support/display-mode.ts'
import { fakeFetch, getRoutes } from '#test/support/fetch.ts'
import { emulateMotion } from '#test/support/motion.ts'
import { renderPage } from '#test/support/render.tsx'

const API: Record<string, unknown> = {
  '/api/workspaces/acme/sidebar': {
    projects: [
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
      pageRoute('/', 'Projects page', {
        'Go to profile': '/account/profile',
        'Go to members': '/inbox',
      }),
      pageRoute('account/profile', 'Profile page', { 'Go to instance': '/instance/accounts' }),
      pageRoute('instance/accounts', 'Accounts page'),
      pageRoute('inbox', 'Inbox page'),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await renderPage(null, { router })
  return router
}

/** The active tab's highlight, and the active tab. */
const indicator = () =>
  document.querySelector<HTMLElement>('[role="tablist"] > [role="presentation"]')!
const activeTab = () => document.querySelector<HTMLElement>('[role="tablist"] [data-active]')!

/** The offset the tab row gives the page's panel (its header sticks below the tabs). */
const panelTop = () =>
  document
    .querySelector<HTMLElement>('[data-panel]')
    ?.style.getPropertyValue('--circi-window-top') ?? ''
const tabs = () => page.getByRole('tab')
const tabNamed = (name: string) => page.getByRole('tab', { name })
const press = (keys: string) => userEvent.keyboard(keys)
const store = () => useTabStore.getState()

mockAuthClient()

beforeEach(async () => {
  await page.viewport(1280, 800)
  fakeFetch(getRoutes(API))
})

describe('tabs in a normal browser tab', () => {
  it('show nothing and leave the keys alone', async () => {
    installedAs('browser')
    await renderApp()
    await expect.element(page.getByRole('heading', { name: 'Projects page' })).toBeVisible()
    expect(tabs().elements()).toHaveLength(0)
    await press('{Alt>}t{/Alt}')
    expect(store().tabs).toHaveLength(0)
    // The page keeps its title with the app's name, and the menu item still opens a browser tab.
    expect(document.title).toBe('Projects page · CirCI')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await page.getByText('Row with a menu').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open in new tab' }).click()
    await expect.poll(() => open).toHaveBeenCalledOnce()
    expect(store().tabs).toHaveLength(0)
  })
})

describe('tabs in the installed app', () => {
  it('shows a strip with the page as the one tab', async () => {
    installedAs('standalone')
    await renderApp()
    await expect.element(tabNamed('Projects page')).toBeVisible()
    expect(tabs().elements()).toHaveLength(1)
    await expect.element(page.getByRole('button', { name: 'New tab' })).toBeVisible()
  })

  it('puts the strip in the frame (below it everything sticks) unless the title bar has it', async () => {
    installedAs('standalone')
    await renderApp()
    await expect.element(tabNamed('Projects page')).toBeVisible()
    expect(panelTop()).toBe('36px')
    // Over the page only: the tabs are in the panel, right of the sidebar, which reaches the top.
    const tab = tabNamed('Projects page').element()
    const sidebar = page.getByRole('navigation', { name: 'Main' }).element().getBoundingClientRect()
    expect(tab.closest('[data-panel]')).not.toBeNull()
    expect(sidebar.top).toBe(0)
    expect(tab.getBoundingClientRect().left).toBeGreaterThanOrEqual(sidebar.right)
    expect(document.documentElement.style.getPropertyValue('--circi-window-top')).toBe('')
  })

  it('leaves the frame without a row in overlay mode, where the title bar carries the tabs', async () => {
    installedAs('overlay')
    await renderApp()
    // The title bar is `display: none` unless the real display-mode media query matches (the
    // mock above only reaches script), so the tab is in the page but not in the accessibility tree.
    await expect
      .poll(() => document.querySelector('[role="tab"]')?.textContent)
      .toBe('Projects page')
    expect(panelTop()).toBe('')
  })

  it('keeps the tabs in full screen, in the frame, and back in the title bar after it', async () => {
    const display = switchableDisplayMode('overlay')
    await renderApp()
    await expect
      .poll(() => document.querySelector('[role="tab"]')?.textContent)
      .toBe('Projects page')
    // The title bar carries them: no row in the frame.
    expect(panelTop()).toBe('')
    // Full screen: no title bar strip, so the frame's row shows the tabs, and the page stays a tab.
    display.switchTo('fullscreen')
    await expect.element(tabNamed('Projects page')).toBeVisible()
    await expect.poll(() => panelTop()).toBe('36px')
    await expect.element(page.getByRole('button', { name: 'New tab' })).toBeVisible()
    // Leaving full screen: back in the title bar, the row gone again.
    display.switchTo('overlay')
    await expect.poll(() => panelTop()).toBe('')
    expect(document.querySelector('[role="tab"]')?.textContent).toBe('Projects page')
  })

  it("keeps a tab's title and width still when hovering shows its close button", async () => {
    installedAs('standalone')
    await renderApp()
    await page.getByRole('button', { name: 'New tab' }).click()
    await expect.poll(() => tabs().elements()).toHaveLength(2)
    // The first tab is in the background now: its close button is hidden until hovered.
    const background = tabs().first()
    const tab = background.element()
    const label = tab.querySelector('span:last-child')!
    const before = {
      tab: tab.getBoundingClientRect().width,
      label: label.getBoundingClientRect().width,
    }
    await background.hover()
    await expect
      .element(page.getByRole('button', { name: `Close ${background.element().textContent}` }))
      .toBeVisible()
    expect(tab.getBoundingClientRect().width).toBe(before.tab)
    expect(label.getBoundingClientRect().width).toBe(before.label)
  })

  it('is one Tab stop; arrow keys, Home and End move between tabs, and Delete closes the focused one', async () => {
    installedAs('standalone')
    await renderApp()
    store().openNew()
    store().openNew()
    await expect.poll(() => tabs().elements()).toHaveLength(3)
    // Only the chosen tab is in the Tab order.
    expect(
      tabs()
        .elements()
        .filter((el) => el.tabIndex === 0),
    ).toHaveLength(1)
    const active = tabs().nth(2)
    active.element().focus()
    await press('{ArrowLeft}')
    await expect.element(tabs().nth(1)).toHaveFocus()
    await press('{Home}')
    await expect.element(tabs().nth(0)).toHaveFocus()
    await press('{End}')
    await expect.element(tabs().nth(2)).toHaveFocus()
    // Moving focus is not choosing: Enter does that.
    await press('{ArrowLeft}')
    expect(store().tabs[1]?.id).not.toBe(store().activeId)
    await press('{Enter}')
    expect(store().tabs[1]?.id).toBe(store().activeId)
    await press('{Delete}')
    await expect.poll(() => tabs().elements()).toHaveLength(2)
  })

  it('keeps the close buttons out of the tablist and out of the Tab order', async () => {
    installedAs('standalone')
    await renderApp()
    store().openNew()
    await expect.poll(() => tabs().elements()).toHaveLength(2)
    const list = document.querySelector('[role="tablist"]')!
    expect(list.querySelector('button:not([role="tab"])')).toBeNull()
    // The close buttons are drawn over the strip, a render after the tabs: wait for both.
    await expect
      .poll(() => page.getByRole('button', { name: /^Close / }).elements())
      .toHaveLength(2)
    const closes = page.getByRole('button', { name: /^Close / }).elements()
    for (const close of closes) {
      expect(list.contains(close)).toBe(false)
      expect(close.tabIndex).toBe(-1)
    }
    // Each sits over its own tab's right edge.
    const [first] = closes
    const tab = tabs().first().element().getBoundingClientRect()
    const box = first!.getBoundingClientRect()
    expect(box.right).toBeLessThanOrEqual(tab.right)
    expect(box.left).toBeGreaterThan(tab.left)
    await page.getByRole('button', { name: /^Close Projects page/ }).click({ force: true })
    await expect.poll(() => tabs().elements()).toHaveLength(1)
  })

  it('glides the highlight to the tab switched to, and fades the page in', async () => {
    await emulateMotion()
    installedAs('standalone')
    await renderApp()
    await page.getByRole('button', { name: 'New tab' }).click()
    await expect.poll(() => tabs().elements()).toHaveLength(2)
    // The highlight sits under the active tab (once its glide has settled).
    await expect.poll(() => indicator().offsetLeft).toBe(activeTab().offsetLeft)
    expect(getComputedStyle(indicator()).transitionProperty).toContain('left')
    const animate = vi.spyOn(HTMLElement.prototype, 'animate')
    const from = indicator().offsetLeft
    await tabs().first().click()
    // It glides: right after the switch its left is a running transition, from the old tab.
    const glide = indicator()
      .getAnimations()
      .find((a) => a instanceof CSSTransition && a.transitionProperty === 'left')
    expect(glide).toBeDefined()
    expect(from).not.toBe(activeTab().offsetLeft)
    // The page fades in (a Web Animation on the panel's parts), the tab row itself doesn't.
    const fades = () =>
      animate.mock.calls.flatMap((call, i) => {
        const el = animate.mock.contexts[i]
        const fade = JSON.stringify(call[0]) === JSON.stringify([{ opacity: 0.35 }, { opacity: 1 }])
        return fade && el instanceof HTMLElement ? [el] : []
      })
    await expect.poll(() => fades().length).toBeGreaterThan(0)
    const parents = new Set([
      document.querySelector('main'),
      document.querySelector('[data-panel] > section'),
    ])
    expect(fades().every((el) => parents.has(el.parentElement))).toBe(true)
    expect(fades().some((el) => el.hasAttribute('data-tab-row'))).toBe(false)
    animate.mockRestore()
    await expect.poll(() => indicator().offsetLeft).toBe(activeTab().offsetLeft)
    expect(activeTab().getAttribute('aria-selected')).toBe('true')
  })

  it("keeps every tab's width when a page changes its title (no jitter)", async () => {
    installedAs('standalone')
    await page.viewport(1280, 800)
    await renderApp()
    await page.getByRole('button', { name: 'New tab' }).click()
    await expect.poll(() => tabs().elements()).toHaveLength(2)
    await tabs().first().click()
    await expect.element(page.getByRole('heading', { name: 'Projects page' })).toBeVisible()
    const widths = () =>
      tabs()
        .elements()
        .map((el) => el.getBoundingClientRect().width)
    const before = widths()
    // The tabs' width is their own, not their titles': 180px each while there's room.
    expect(before).toEqual([180, 180])
    await page.getByRole('button', { name: 'Go to members' }).click()
    await expect.poll(() => tabs().first().element().textContent).toBe('Inbox page')
    expect(widths()).toEqual(before)
  })

  it('opens a tab from the menu, and each tab keeps its own page', async () => {
    installedAs('standalone')
    await renderApp()
    await page.getByRole('button', { name: 'Go to profile' }).click()
    await expect.element(tabNamed('Profile page')).toBeVisible()
    await page.getByText('Row with a menu').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open in new tab' }).click()
    await expect.poll(() => tabs().elements()).toHaveLength(2)
    // It opens behind the page being read.
    await expect.element(page.getByRole('heading', { name: 'Profile page' })).toBeVisible()
    await page.getByRole('button', { name: 'New tab' }).click()
    await expect.element(page.getByRole('heading', { name: 'Inbox page' })).toBeVisible()
    await tabNamed('Profile page').first().click()
    await expect.element(page.getByRole('heading', { name: 'Profile page' })).toBeVisible()
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
    await expect.element(page.getByRole('heading', { name: 'Projects page' })).toBeVisible()
  })

  it('keeps back inside the tab', async () => {
    installedAs('standalone')
    const router = await renderApp()
    await page.getByRole('button', { name: 'Go to profile' }).click()
    await expect.element(page.getByRole('heading', { name: 'Profile page' })).toBeVisible()
    await press('{Alt>}t{/Alt}')
    await expect.element(page.getByRole('heading', { name: 'Inbox page' })).toBeVisible()
    // Back in the new tab has nowhere to go but the tab it was opened from.
    router.history.back()
    await expect.element(page.getByRole('heading', { name: 'Profile page' })).toBeVisible()
    expect(tabs().elements()).toHaveLength(1)
    // Back in the first tab walks its own pages.
    router.history.back()
    await expect.element(page.getByRole('heading', { name: 'Projects page' })).toBeVisible()
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
    await expect
      .element(page.getByText('Closed Projects page to stay within 12 tabs'))
      .toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.element(tabNamed('Projects page')).toBeVisible()
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

const pointer = (el: Element, type: string, x: number) =>
  el.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 100 }),
  )

async function phone() {
  installedAs('standalone')
  await page.viewport(390, 800)
  await renderApp()
  await expect.element(page.getByRole('button', { name: 'Tabs, 1 open' })).toBeVisible()
}

describe('tabs on a phone, installed', () => {
  it('has no strip, a count button in the header, and a sheet of cards', async () => {
    await phone()
    expect(tabs().elements()).toHaveLength(0)
    store().openNew()
    await page.getByRole('button', { name: 'Tabs, 2 open' }).click()
    const sheet = page.getByRole('dialog', { name: '2 tabs' })
    await expect.element(sheet).toBeVisible()
    await expect.element(sheet.getByRole('button', { name: /Close Projects page/ })).toBeVisible()
    await sheet
      .getByRole('button', { name: /Projects page/ })
      .first()
      .click()
    await expect.element(page.getByRole('heading', { name: /^Projects page/ })).toBeVisible()
    await expect.poll(() => page.getByRole('dialog', { name: '2 tabs' }).elements().length).toBe(0)
  })

  it('closes a card with its × or a swipe', async () => {
    await phone()
    store().openNew()
    store().openNew()
    await page.getByRole('button', { name: 'Tabs, 3 open' }).click()
    await page.getByRole('button', { name: /^Close Projects page/ }).click()
    await expect.poll(() => store().tabs).toHaveLength(2)
    const card = page.getByRole('button', { name: /^Close (New tab|Inbox page)/ }).first()
    const li = card.element().closest('li')
    if (!li) throw new Error('no card')
    pointer(li, 'pointerdown', 200)
    pointer(li, 'pointermove', 340)
    pointer(li, 'pointerup', 340)
    await expect.poll(() => store().tabs.length).toBe(1)
  })

  it('does not open a tab when a short sideways drag is released on it', async () => {
    await phone()
    store().openNew()
    const before = store().activeId
    await page.getByRole('button', { name: 'Tabs, 2 open' }).click()
    const open = page.getByRole('button', { name: /^Projects page/ }).element()
    const li = open.closest('li')
    if (!li) throw new Error('no card')
    // 20px: more than a tap, far less than a swipe that closes.
    pointer(li, 'pointerdown', 200)
    pointer(li, 'pointermove', 220)
    pointer(li, 'pointerup', 220)
    open.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(store().activeId).toBe(before)
    expect(store().tabs).toHaveLength(2)
    await expect.element(page.getByRole('dialog', { name: '2 tabs' })).toBeVisible()
    // A plain tap still opens it.
    pointer(li, 'pointerdown', 200)
    pointer(li, 'pointerup', 201)
    open.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(store().activeId).not.toBe(before)
  })

  it('opens Pin, Close and Close others on a long press', async () => {
    await phone()
    store().openNew()
    await page.getByRole('button', { name: 'Tabs, 2 open' }).click()
    const li = page
      .getByRole('button', { name: /^Close Projects page/ })
      .element()
      .closest('li')
    if (!li) throw new Error('no card')
    pointer(li, 'pointerdown', 200)
    await expect.element(page.getByRole('button', { name: 'Close other tabs' })).toBeVisible()
    // The same set the desktop tab menu offers.
    const names = ['Pin tab', 'Duplicate tab', 'Copy link', 'Close tab', 'Close other tabs']
    expect(
      names.map((name) => page.getByRole('button', { name, exact: true }).elements().length),
    ).toEqual([1, 1, 1, 1, 1])
    await page.getByRole('button', { name: 'Pin tab' }).click()
    await expect.poll(() => store().tabs.filter((t) => t.pinned)).toHaveLength(1)
  })

  it('saves the panel scroll when leaving a tab and puts it back on return, leaving the window alone', async () => {
    await phone()
    const panel = document.getElementById('content')!
    const filler = document.createElement('div')
    filler.style.cssText = 'height: 3000px; flex-shrink: 0'
    panel.append(filler)
    panel.scrollTo({ top: 400 })
    await expect.poll(() => panel.scrollTop).toBe(400)
    const first = store().tabs[0]!.id
    store().openNew()
    await expect.poll(() => store().tabs.find((t) => t.id === first)?.scroll).toBe(400)
    expect(window.scrollY).toBe(0)
    store().activate(first)
    await expect.poll(() => document.getElementById('content')!.scrollTop).toBe(400)
    expect(window.scrollY).toBe(0)
  })
})
