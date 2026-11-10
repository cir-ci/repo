import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { AppFrame, PanelHeader } from '#src/index.ts'

describe('PanelHeader', () => {
  it('is a header at least 44px high with the title left and actions right', async () => {
    await render(
      <PanelHeader actions={<button type="button">Approve</button>}>
        <span>web-app / #148</span>
      </PanelHeader>,
    )
    const header = page.getByRole('banner').element()
    expect(header.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    const title = page.getByText('web-app / #148').element()
    const action = page.getByRole('button', { name: 'Approve' }).element()
    expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(
      action.getBoundingClientRect().left,
    )
  })

  it('stays at the top of the window while the page scrolls, and gives the panel its height', async () => {
    await page.viewport(1200, 600)
    await render(
      <AppFrame sidebar="Side">
        <PanelHeader actions={<button type="button">Approve</button>}>
          <span>Insights</span>
        </PanelHeader>
        <div style={{ height: 3000 }}>Long page</div>
      </AppFrame>,
    )
    // Inside the main landmark a <header> is not a banner.
    const header = page.getByRole('main').element().querySelector('header')!
    window.scrollTo(0, 1500)
    await expect.poll(() => window.scrollY).toBeGreaterThan(1000)
    await expect.poll(() => header.getBoundingClientRect().top).toBe(0)
    const main = page.getByRole('main').element()
    // The header's height, below the installed app's title bar (none here: 0).
    expect(main.style.getPropertyValue('--circi-page-top')).toBe(
      `calc(var(--circi-window-top, 0px) + ${header.getBoundingClientRect().height}px)`,
    )
  })
})
