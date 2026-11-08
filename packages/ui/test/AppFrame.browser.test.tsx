import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { AppFrame } from '../src/index.ts'

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
    expect(nav.parentElement?.getBoundingClientRect().height).toBeGreaterThanOrEqual(300)
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
