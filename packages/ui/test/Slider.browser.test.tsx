import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Slider } from '../src/index.ts'

describe('Slider', () => {
  it('is a slider named by its label with the range and value', async () => {
    await render(<Slider label="Swipe position" defaultValue={50} />)
    const slider = page.getByRole('slider', { name: 'Swipe position' })
    await expect.element(slider).toHaveAttribute('aria-valuenow', '50')
    await expect.element(slider).toHaveAttribute('min', '0')
    await expect.element(slider).toHaveAttribute('max', '100')
  })

  it('moves with the arrow keys and Home / End and reports a number', async () => {
    const onValueChange = vi.fn<(value: number) => void>()
    function Controlled() {
      const [value, setValue] = useState(50)
      return (
        <Slider
          label="Swipe position"
          value={value}
          onValueChange={(next) => {
            onValueChange(next)
            setValue(next)
          }}
          step={5}
        />
      )
    }
    await render(<Controlled />)
    const slider = page.getByRole('slider', { name: 'Swipe position' })
    await userEvent.tab()
    await expect.element(slider).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '55')
    expect(onValueChange).toHaveBeenLastCalledWith(55)
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '45')
    await userEvent.keyboard('{End}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '100')
    await userEvent.keyboard('{Home}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '0')
  })

  it('is disabled when disabled', async () => {
    await render(<Slider label="Swipe position" defaultValue={50} disabled />)
    await expect.element(page.getByRole('slider', { name: 'Swipe position' })).toBeDisabled()
  })
})
