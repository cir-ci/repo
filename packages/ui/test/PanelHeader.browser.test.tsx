import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { AppFrame, PanelHeader } from '#src/index.ts'

/** The tops of the four action buttons: all equal when they share a line. */
const tops = () =>
  ['Request review', 'Reject', 'Approve', 'Approve all'].map(
    (name) => page.getByRole('button', { name }).element().getBoundingClientRect().top,
  )

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

  it('moves its actions to the next line together, at the left, when they no longer fit beside the title', async () => {
    const actions = (
      <>
        {['Request review', 'Reject', 'Approve', 'Approve all'].map((name) => (
          <button key={name} type="button" style={{ width: 120 }}>
            {name}
          </button>
        ))}
      </>
    )
    // Room for the title and all four (4 x 120px): one line.
    await render(
      <div style={{ width: 900 }}>
        <PanelHeader actions={actions}>
          <span style={{ display: 'inline-block', width: 300 }}>Build #34 feat/search</span>
        </PanelHeader>
      </div>,
    )
    const title = page.getByText('Build #34 feat/search').element()
    expect(new Set(tops()).size).toBe(1)
    // Too narrow for both: not one button dropping at a time, the whole group on the next line.
    title.closest('div')!.style.width = '700px'
    await expect.poll(() => new Set(tops()).size).toBe(1)
    expect(tops()[0]).toBeGreaterThan(title.getBoundingClientRect().bottom - 1)
    // On their own line they start at the left, under the title.
    const first = page
      .getByRole('button', { name: 'Request review' })
      .element()
      .getBoundingClientRect()
    expect(Math.abs(first.left - title.getBoundingClientRect().left)).toBeLessThan(2)
  })

  it('stays at the top of the panel while the page scrolls, and gives the panel its height', async () => {
    await page.viewport(1200, 600)
    await render(
      <AppFrame sidebar="Side">
        <PanelHeader actions={<button type="button">Approve</button>}>
          <span>Insights</span>
        </PanelHeader>
        <div style={{ height: 3000, flexShrink: 0 }}>Long page</div>
      </AppFrame>,
    )
    // Inside the main landmark a <header> is not a banner.
    const header = page.getByRole('main').element().querySelector('header')!
    const main = page.getByRole('main').element()
    main.scrollTo({ top: 1500 })
    await expect.poll(() => main.scrollTop).toBeGreaterThan(1000)
    // Inside the panel's 1px top border.
    await expect
      .poll(() => header.getBoundingClientRect().top)
      .toBe(main.getBoundingClientRect().top + 1)
    // The header's height, below the installed app's title bar (none here: 0).
    expect(main.style.getPropertyValue('--circi-page-top')).toBe(
      `calc(var(--circi-window-top, 0px) + ${header.getBoundingClientRect().height}px)`,
    )
  })
})
