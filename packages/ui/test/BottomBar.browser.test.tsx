import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { AppFrame, BottomBar, BottomBarItem, InboxIcon, ReviewIcon } from '#src/index.ts'

const bar = (
  <BottomBar label="Pages">
    <BottomBarItem href="/inbox" icon={<InboxIcon />} selected count={3} countLabel="unread">
      Inbox
    </BottomBarItem>
    <BottomBarItem href="/reviews" icon={<ReviewIcon />}>
      Reviews
    </BottomBarItem>
    <BottomBarItem icon={<ReviewIcon />}>More</BottomBarItem>
  </BottomBar>
)

afterEach(async () => {
  await page.viewport(1000, 700)
})

describe('BottomBar', () => {
  it('is a navigation with links and buttons of 44px or more, a badge and the current page marked', async () => {
    await page.viewport(390, 844)
    await render(bar)
    const nav = page.getByRole('navigation', { name: 'Pages' })
    await expect.element(nav).toBeVisible()
    const inbox = nav.getByRole('link', { name: /^Inbox/ })
    await expect.element(inbox).toHaveAttribute('aria-current', 'page')
    await expect.element(nav.getByRole('link', { name: 'Reviews' })).toBeVisible()
    await expect.element(nav.getByRole('button', { name: 'More' })).toBeVisible()
    for (const item of [
      ...nav.getByRole('link').elements(),
      ...nav.getByRole('button').elements(),
    ]) {
      const box = item.getBoundingClientRect()
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }
  })
})

describe('AppFrame with a bottom bar', () => {
  const frame = (
    <AppFrame sidebar={<span>Side</span>} compactBar={<span>Bar</span>} bottomBar={bar}>
      <p>Page</p>
    </AppFrame>
  )

  it('pins the bar to the bottom of the window and makes the panel full-bleed on a phone', async () => {
    await page.viewport(390, 844)
    await render(frame)
    const nav = page.getByRole('navigation', { name: 'Pages' })
    await expect.element(nav).toBeVisible()
    expect(Math.round(nav.element().getBoundingClientRect().bottom)).toBe(844)
    const main = page.getByRole('main').element()
    const box = main.getBoundingClientRect()
    expect(Math.round(box.left)).toBe(0)
    expect(Math.round(box.right)).toBe(390)
    expect(getComputedStyle(main).borderTopLeftRadius).toBe('0px')
    // The panel ends where the bar starts.
    expect(Math.round(box.bottom)).toBe(Math.round(nav.element().getBoundingClientRect().top))
  })

  it('is hidden from 820px up, where the panel is the inset card again', async () => {
    await page.viewport(1280, 800)
    await render(frame)
    expect(page.getByRole('navigation', { name: 'Pages' }).elements()).toHaveLength(0)
    // The card is the panel around the header and main.
    const panel = page.getByRole('main').element().closest('[data-panel]')!
    expect(panel.getBoundingClientRect().left).toBeGreaterThan(0)
    expect(Number.parseFloat(getComputedStyle(panel).borderTopLeftRadius)).toBeGreaterThan(0)
  })
})
