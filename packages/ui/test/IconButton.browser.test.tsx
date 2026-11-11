import { X } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { IconButton } from '#src/index.ts'

describe('IconButton', () => {
  it('is a button named by its label, 28×28, and calls onClick', async () => {
    const onClick = vi.fn<() => void>()
    await render(
      <IconButton label="Close" onClick={onClick}>
        <X />
      </IconButton>,
    )
    const button = page.getByRole('button', { name: 'Close' })
    await expect.element(button).toHaveAttribute('type', 'button')
    // The stylesheet may land a moment after the first paint on a busy machine.
    await expect
      .poll(() => {
        const style = getComputedStyle(button.element())
        return [style.width, style.height]
      })
      .toEqual(['28px', '28px'])
    await button.click()
    await expect.poll(() => onClick.mock.calls.length).toBe(1)
  })

  it('sizes the icon to 16px', async () => {
    await render(
      <IconButton label="Close">
        <X />
      </IconButton>,
    )
    const button = page.getByRole('button', { name: 'Close' })
    await expect
      .poll(() => {
        const svg = button.element().querySelector('svg')
        return svg && getComputedStyle(svg).width
      })
      .toBe('16px')
  })

  it('is inert when disabled', async () => {
    const onClick = vi.fn<() => void>()
    await render(
      <IconButton label="Close" disabled onClick={onClick}>
        <X />
      </IconButton>,
    )
    const button = page.getByRole('button', { name: 'Close' })
    await expect.element(button).toBeDisabled()
    await button.click({ force: true })
    expect(onClick).not.toHaveBeenCalled()
  })
})
