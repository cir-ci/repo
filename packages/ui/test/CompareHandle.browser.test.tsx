import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { CompareHandle } from '#src/index.ts'

function Stage() {
  const [value, setValue] = useState(50)
  return (
    <div style={{ position: 'relative', width: 400, height: 200 }} data-testid="stage">
      <CompareHandle label="Slider position" value={value} onValueChange={setValue} />
    </div>
  )
}

describe('CompareHandle', () => {
  it('is a slider named by its label with the range and value', async () => {
    await render(<Stage />)
    const slider = page.getByRole('slider', { name: 'Slider position' })
    await expect.element(slider).toHaveAttribute('aria-valuenow', '50')
    await expect.element(slider).toHaveAttribute('min', '0')
    await expect.element(slider).toHaveAttribute('max', '100')
  })

  it('moves with the arrow keys and Home / End', async () => {
    await render(<Stage />)
    const slider = page.getByRole('slider', { name: 'Slider position' })
    slider.element().focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowLeft}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '51')
    await userEvent.keyboard('{Home}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '0')
    await userEvent.keyboard('{End}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '100')
  })

  it('covers the whole box, so a press anywhere on it is on the control', async () => {
    await render(<Stage />)
    const box = page.getByTestId('stage').element().getBoundingClientRect()
    for (const [x, y] of [
      [0.05, 0.05],
      [0.95, 0.95],
      [0.5, 0.5],
    ] as const) {
      const hit = document.elementFromPoint(box.left + box.width * x, box.top + box.height * y)
      expect(hit?.closest('[data-base-ui-slider-control], [class*="control"]')).not.toBeNull()
    }
  })

  it('is reached with Tab', async () => {
    await render(<Stage />)
    await userEvent.tab()
    await expect.element(page.getByRole('slider', { name: 'Slider position' })).toHaveFocus()
  })
})
