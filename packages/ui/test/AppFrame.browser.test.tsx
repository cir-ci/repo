import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { AppFrame, PanelHeader, ResizeHandle } from '#src/index.ts'

// Headless Chromium draws overlay scrollbars (no layout width): read the sizes the CSS sets.
const bar = (el: Element) => getComputedStyle(el, '::-webkit-scrollbar').width

describe('AppFrame', () => {
  it('has a Main navigation landmark and a main landmark holding the page', async () => {
    await render(
      <AppFrame sidebar={<a href="/x">Projects</a>} minHeight={200}>
        Page
      </AppFrame>,
    )
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect
      .element(nav)
      .toContainElement(page.getByRole('link', { name: 'Projects' }).element())
    const main = page.getByRole('main')
    await expect.element(main).toHaveTextContent('Page')
    await expect.element(main).toHaveAttribute('id', 'content')
  })

  it('lays the sidebar beside the panel on wide screens and honours minHeight', async () => {
    await page.viewport(1200, 800)
    await render(
      <AppFrame sidebar="Side" minHeight={300}>
        Page
      </AppFrame>,
    )
    const nav = page.getByRole('navigation').element()
    const main = page.getByRole('main').element()
    expect(main.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      nav.getBoundingClientRect().right - 1,
    )
    expect(nav.parentElement?.parentElement?.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      300,
    )
  })

  it('stacks the sidebar above the panel on narrow screens', async () => {
    await page.viewport(600, 800)
    await render(<AppFrame sidebar="Side">Page</AppFrame>)
    const nav = page.getByRole('navigation').element()
    const main = page.getByRole('main').element()
    expect(main.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      nav.getBoundingClientRect().bottom - 1,
    )
  })
})

describe('AppFrame compactBar', () => {
  it('shows the bar instead of the sidebar below 820px', async () => {
    await page.viewport(600, 800)
    await render(
      <AppFrame sidebar={<a href="/x">Projects</a>} compactBar={<span>Bar</span>}>
        Page
      </AppFrame>,
    )
    await expect.element(page.getByText('Bar')).toBeVisible()
    expect(page.getByRole('navigation').elements()).toHaveLength(0)
  })

  it('hides the bar and shows the sidebar from 820px up', async () => {
    await page.viewport(820, 800)
    await render(
      <AppFrame sidebar={<a href="/x">Projects</a>} compactBar={<span>Bar</span>}>
        Page
      </AppFrame>,
    )
    await expect.element(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await expect.element(page.getByText('Bar')).not.toBeVisible()
  })

  it('stacks below 820px but not at 850px', async () => {
    await page.viewport(850, 800)
    await render(<AppFrame sidebar="Side">Page</AppFrame>)
    const nav = page.getByRole('navigation').element()
    const main = page.getByRole('main').element()
    expect(main.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      nav.getBoundingClientRect().right - 1,
    )
  })

  it('keeps the sidebar, and the account menu at its foot, in view on a page taller than the window', async () => {
    await page.viewport(1200, 700)
    await render(
      <AppFrame
        sidebar={
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <a href="/x">Projects</a>
            <button type="button" style={{ marginTop: 'auto' }}>
              Account menu
            </button>
          </div>
        }
      >
        <div style={{ height: 2400 }}>A very long page</div>
      </AppFrame>,
    )
    const menu = page
      .getByRole('button', { name: 'Account menu' })
      .element()
      .getBoundingClientRect()
    expect(menu.bottom).toBeLessThanOrEqual(window.innerHeight)
    // Still there after scrolling down the page.
    window.scrollTo(0, 1500)
    const after = page
      .getByRole('button', { name: 'Account menu' })
      .element()
      .getBoundingClientRect()
    expect(after.bottom).toBeLessThanOrEqual(window.innerHeight)
    expect(after.top).toBeGreaterThanOrEqual(0)
  })
})

const handle = (extra: { style?: { left: string } } = {}) => (
  <ResizeHandle
    label="Resize the sidebar"
    value={300}
    min={200}
    max={360}
    defaultValue={244}
    onValueChange={() => undefined}
    {...extra}
  />
)

describe('AppFrame resizable sidebar', () => {
  it('takes its width from sidebarWidth and shows the handle beside the panel', async () => {
    await page.viewport(1200, 800)
    await render(
      <AppFrame
        sidebar="Side"
        sidebarWidth={300}
        sidebarHandle={handle({ style: { left: '100%' } })}
        minHeight={300}
      >
        Page
      </AppFrame>,
    )
    expect(page.getByRole('navigation').element().getBoundingClientRect().width).toBe(300)
    await expect.element(page.getByRole('separator', { name: 'Resize the sidebar' })).toBeVisible()
  })

  it('hides the sidebar and its handle when collapsed, and the panel takes the room', async () => {
    await page.viewport(1200, 800)
    await render(
      <AppFrame sidebar="Side" sidebarCollapsed sidebarHandle={handle()}>
        Page
      </AppFrame>,
    )
    expect(page.getByRole('navigation').elements()).toHaveLength(0)
    expect(page.getByRole('separator').elements()).toHaveLength(0)
    expect(page.getByRole('main').element().getBoundingClientRect().left).toBe(8)
  })

  it('has no handle below 820px', async () => {
    await page.viewport(600, 800)
    await render(
      <AppFrame sidebar="Side" sidebarHandle={handle()}>
        Page
      </AppFrame>,
    )
    expect(page.getByRole('separator').elements()).toHaveLength(0)
  })

  it('gives the sidebar a narrower scrollbar than the page, marked while it scrolls', async () => {
    await page.viewport(1200, 400)
    await render(
      <AppFrame sidebar={<div style={{ height: 2000, flexShrink: 0 }}>Long sidebar</div>}>
        <div style={{ height: 2000, flexShrink: 0 }}>Long page</div>
      </AppFrame>,
    )
    const nav = page.getByRole('navigation', { name: 'Main' }).element()
    expect(bar(nav)).toBe('6px')
    expect(bar(document.documentElement)).toBe('10px')
    expect(nav.scrollHeight).toBeGreaterThan(nav.clientHeight)
    nav.scrollTop = 200
    await expect.poll(() => nav.hasAttribute('data-scrolling')).toBe(true)
  })
})

const framed = () => (
  <AppFrame sidebar="Side" compact bottomBar={<div style={{ height: 56 }}>Tabs</div>}>
    <PanelHeader>
      <span>Title</span>
    </PanelHeader>
    <div style={{ height: 3000, flexShrink: 0 }}>Long page</div>
  </AppFrame>
)

describe('AppFrame on a phone: the panel scrolls, not the window', () => {
  it('is the window tall, scrolls the panel, and ends the panel where the bottom bar starts', async () => {
    await page.viewport(390, 844)
    await render(framed())
    const main = page.getByRole('main').element()
    const tabBar = page.getByText('Tabs').element()
    expect(getComputedStyle(main).overflowY).toBe('auto')
    expect(main.scrollHeight).toBeGreaterThan(main.clientHeight)
    expect(main.getBoundingClientRect().bottom).toBeCloseTo(tabBar.getBoundingClientRect().top, 0)
    expect(tabBar.getBoundingClientRect().bottom).toBeCloseTo(window.innerHeight, 0)
    // The window itself has nothing to scroll.
    expect(document.scrollingElement!.scrollHeight).toBeLessThanOrEqual(window.innerHeight)
    window.scrollTo(0, 500)
    expect(window.scrollY).toBe(0)
  })

  it('keeps the page header at the top of the panel while the panel scrolls', async () => {
    await page.viewport(390, 844)
    await render(framed())
    const main = page.getByRole('main').element()
    const header = main.querySelector('header')!
    main.scrollTo({ top: 1200 })
    await expect.poll(() => main.scrollTop).toBe(1200)
    // Inside the panel's 1px top border.
    expect(header.getBoundingClientRect().top).toBeCloseTo(main.getBoundingClientRect().top + 1, 0)
  })

  it('keeps the window scrolling and the sidebar in place at 1280px', async () => {
    await page.viewport(1280, 700)
    await render(
      <AppFrame sidebar="Side" compact bottomBar={<div>Tabs</div>}>
        <div style={{ height: 3000, flexShrink: 0 }}>Long page</div>
      </AppFrame>,
    )
    const main = page.getByRole('main').element()
    expect(getComputedStyle(main).overflowY).not.toBe('auto')
    window.scrollTo(0, 800)
    await expect.poll(() => window.scrollY).toBe(800)
    expect(main.scrollTop).toBe(0)
    const side = page.getByRole('navigation').element().parentElement!
    expect(side.getBoundingClientRect().top).toBe(0)
  })
})
