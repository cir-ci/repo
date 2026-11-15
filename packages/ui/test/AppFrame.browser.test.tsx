import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

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
        <div style={{ height: 2400, flexShrink: 0 }}>A very long page</div>
      </AppFrame>,
    )
    const menu = page
      .getByRole('button', { name: 'Account menu' })
      .element()
      .getBoundingClientRect()
    expect(menu.bottom).toBeLessThanOrEqual(window.innerHeight)
    // Still there after scrolling down the page (the panel scrolls, not the window).
    const panel = page.getByRole('main').element()
    panel.scrollTo({ top: 1500 })
    await expect.poll(() => panel.scrollTop).toBe(1500)
    const after = page
      .getByRole('button', { name: 'Account menu' })
      .element()
      .getBoundingClientRect()
    expect(after.bottom).toBeLessThanOrEqual(window.innerHeight)
    expect(after.top).toBeGreaterThanOrEqual(0)
  })
})

const rows = (n: number) => (
  <AppFrame sidebar="Side">
    <PanelHeader>
      <span>Title</span>
    </PanelHeader>
    <div style={{ height: n, flexShrink: 0 }}>Page</div>
  </AppFrame>
)

const sideBox = () => page.getByRole('navigation').element().parentElement!.getBoundingClientRect()
const mainBox = () => page.getByRole('main').element().getBoundingClientRect()
const pageWidth = () => page.getByText('Page').element().getBoundingClientRect().width

describe('AppFrame from 820px up: the panel scrolls, not the window', () => {
  it('is the window tall, scrolls the panel, and leaves the window with nothing to scroll', async () => {
    await page.viewport(1280, 800)
    await render(rows(3000))
    const main = page.getByRole('main').element()
    expect(getComputedStyle(main).overflowY).toBe('auto')
    expect(main.scrollHeight).toBeGreaterThan(main.clientHeight)
    expect(document.scrollingElement!.scrollHeight).toBeLessThanOrEqual(window.innerHeight)
    window.scrollTo(0, 500)
    expect(window.scrollY).toBe(0)
    const side = page.getByRole('navigation').element().parentElement!
    expect(side.getBoundingClientRect().height).toBe(window.innerHeight)
  })

  it('keeps the page header above the scroller while the panel scrolls', async () => {
    await page.viewport(1280, 800)
    await render(rows(3000))
    const main = page.getByRole('main').element()
    const header = document.querySelector('header')!
    main.scrollTo({ top: 1200 })
    await expect.poll(() => main.scrollTop).toBe(1200)
    // The header is above the scroller, and does not move: the scrollbar starts under it.
    const panel = document.querySelector('[data-panel]')!.getBoundingClientRect()
    expect(header.getBoundingClientRect().top).toBeCloseTo(panel.top + 1, 0)
    expect(main.getBoundingClientRect().top).toBeCloseTo(header.getBoundingClientRect().bottom, 0)
    expect(main.contains(header)).toBe(false)
  })

  it('moves neither the sidebar nor the panel when the content grows past the window', async () => {
    await page.viewport(1280, 800)
    const view = await render(rows(100))
    const before = { side: sideBox(), main: mainBox() }
    await view.rerender(rows(5000))
    const after = { side: sideBox(), main: mainBox() }
    expect(after.side.left).toBe(before.side.left)
    expect(after.side.width).toBe(before.side.width)
    expect(after.main.left).toBe(before.main.left)
    expect(after.main.width).toBe(before.main.width)
    expect(after.main.height).toBe(before.main.height)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  })

  it('keeps a stable scrollbar gutter, so a page that grows long does not reflow its content', async () => {
    await page.viewport(1280, 800)
    const view = await render(rows(100))
    const main = page.getByRole('main').element()
    expect(getComputedStyle(main).scrollbarGutter).toContain('stable')
    const before = pageWidth()
    await view.rerender(rows(5000))
    expect(pageWidth()).toBe(before)
  })
})

describe('AppFrame with classic, space-taking scrollbars', () => {
  it('takes the scrollbar from the scroller alone: the header and the content keep their width when a page grows long', async () => {
    const style = document.createElement('style')
    style.textContent = '*::-webkit-scrollbar { width: 12px; height: 12px }'
    document.head.append(style)
    try {
      await page.viewport(1280, 800)
      const view = await render(rows(100))
      const main = document.getElementById('content')!
      const header = document.querySelector<HTMLElement>('header')!
      const before = { header: header.getBoundingClientRect(), page: pageWidth() }
      await view.rerender(rows(5000))
      expect(main.scrollHeight).toBeGreaterThan(main.clientHeight)
      expect(main.offsetWidth - main.clientWidth).toBe(12)
      expect(header.offsetWidth).toBe(header.clientWidth)
      const after = header.getBoundingClientRect()
      expect(after.left).toBe(before.header.left)
      expect(after.width).toBe(before.header.width)
      expect(pageWidth()).toBe(before.page)
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
      expect(window.scrollX).toBe(0)
    } finally {
      style.remove()
    }
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
    expect(page.getByRole('main').element().getBoundingClientRect().left).toBe(9)
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

  it('scrolls the sidebar in the nav landmark with an overlay thumb, the page keeps its 10px bar', async () => {
    await page.viewport(1200, 400)
    await render(
      <AppFrame sidebar={<div style={{ height: 2000, flexShrink: 0 }}>Long sidebar</div>}>
        <div style={{ height: 2000, flexShrink: 0 }}>Long page</div>
      </AppFrame>,
    )
    const nav = page.getByRole('navigation', { name: 'Main' }).element()
    expect(nav.tagName).toBe('NAV')
    expect(nav.scrollHeight).toBeGreaterThan(nav.clientHeight)
    // The nav is the viewport: no wrapper between it and its entries in the accessibility tree.
    expect(page.getByRole('navigation').elements()).toHaveLength(1)
    expect(bar(page.getByRole('main').element())).toBe('10px')
    // The sidebar scrolls inside the frame: the window itself never does.
    expect(document.scrollingElement!.scrollHeight).toBeLessThanOrEqual(window.innerHeight)
    await userEvent.hover(nav)
    const thumb = document.querySelector('[data-orientation="vertical"] > div')!
    await expect.poll(() => getComputedStyle(thumb.parentElement!).opacity).toBe('1')
    // The thumb lies within the nav's 8px right padding.
    const navBox = nav.getBoundingClientRect()
    const thumbBox = thumb.getBoundingClientRect()
    expect(thumbBox.right).toBeLessThanOrEqual(navBox.right)
    expect(thumbBox.width).toBeLessThanOrEqual(8)
  })

  it('keeps an entry the same width with and without sidebar overflow', async () => {
    await page.viewport(1200, 400)
    const entry = <a href="/x">Entry</a>
    const { rerender } = await render(
      <AppFrame sidebar={entry} sidebarWidth={244}>
        Page
      </AppFrame>,
    )
    const nav = page.getByRole('navigation', { name: 'Main' }).element()
    const link = page.getByRole('link', { name: 'Entry' }).element()
    expect(nav.scrollHeight).toBeLessThanOrEqual(nav.clientHeight)
    const without = link.getBoundingClientRect().width
    await rerender(
      <AppFrame
        sidebar={
          <>
            {entry}
            <div style={{ height: 2000, flexShrink: 0 }}>Long sidebar</div>
          </>
        }
        sidebarWidth={244}
      >
        Page
      </AppFrame>,
    )
    await expect.poll(() => nav.scrollHeight > nav.clientHeight).toBe(true)
    expect(link.getBoundingClientRect().width).toBe(without)
    // Content that grew after mount still gets its thumb, without a scroll first.
    await userEvent.hover(nav)
    await expect.poll(() => document.querySelector('[data-orientation="vertical"]')).not.toBeNull()
    // 244px sidebar less the 8px padding on both sides.
    expect(without).toBe(228)
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

  it('keeps the page header above the scroller while the panel scrolls', async () => {
    await page.viewport(390, 844)
    await render(framed())
    const main = page.getByRole('main').element()
    const header = document.querySelector('header')!
    main.scrollTo({ top: 1200 })
    await expect.poll(() => main.scrollTop).toBe(1200)
    // Inside the panel's 1px top border.
    // The header is above the scroller, and does not move: the scrollbar starts under it.
    const panel = document.querySelector('[data-panel]')!.getBoundingClientRect()
    expect(header.getBoundingClientRect().top).toBeCloseTo(panel.top + 1, 0)
    expect(main.getBoundingClientRect().top).toBeCloseTo(header.getBoundingClientRect().bottom, 0)
    expect(main.contains(header)).toBe(false)
  })
})
