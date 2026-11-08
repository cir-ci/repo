import { X } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { IconButton, Tooltip } from '../src/index.ts'

function Harness(props: { delay?: number }) {
  return (
    <Tooltip content="Close the panel" delay={props.delay}>
      <IconButton label="Close">
        <X />
      </IconButton>
    </Tooltip>
  )
}

describe('Tooltip', () => {
  it('opens when the trigger gets keyboard focus and closes on Escape', async () => {
    await render(<Harness />)
    await userEvent.tab()
    await expect.element(page.getByRole('button', { name: 'Close' })).toHaveFocus()
    await expect.element(page.getByText('Close the panel')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByText('Close the panel')).not.toBeInTheDocument()
  })

  it('opens on hover only after its delay, and closes when the pointer leaves', async () => {
    await page.viewport(800, 600)
    await render(<Harness />)
    const button = page.getByRole('button', { name: 'Close' })
    await userEvent.hover(button)
    // Nothing yet: the delay is 500ms.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(page.getByText('Close the panel').query()).toBeNull()
    await expect.element(page.getByText('Close the panel'), { timeout: 3000 }).toBeVisible()
    await userEvent.unhover(button)
    await expect.element(page.getByText('Close the panel')).not.toBeInTheDocument()
  })

  it('places the popup above the trigger by default', async () => {
    await page.viewport(800, 600)
    await render(
      <div style={{ paddingTop: 120 }}>
        <Harness delay={0} />
      </div>,
    )
    const button = page.getByRole('button', { name: 'Close' })
    await userEvent.hover(button)
    const tip = page.getByText('Close the panel')
    await expect.element(tip).toBeVisible()
    expect(tip.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
      button.element().getBoundingClientRect().top,
    )
  })

  it('has an 8px radius', async () => {
    await render(<Harness />)
    await userEvent.tab()
    const popup = page.getByText('Close the panel').element()
    expect(getComputedStyle(popup).borderTopLeftRadius).toBe('8px')
  })
})
