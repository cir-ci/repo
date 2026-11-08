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
    const style = getComputedStyle(button.element())
    expect([style.width, style.height]).toEqual(['28px', '28px'])
    await button.click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('sizes the icon to 16px', async () => {
    await render(
      <IconButton label="Close">
        <X />
      </IconButton>,
    )
    const svg = page.getByRole('button', { name: 'Close' }).element().querySelector('svg')
    expect(svg && getComputedStyle(svg).width).toBe('16px')
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
