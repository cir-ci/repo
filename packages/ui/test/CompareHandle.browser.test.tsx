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

  it('draws two chevron icons on the grip, hidden from assistive tech', async () => {
    await render(<Stage />)
    const grip = page
      .getByRole('slider', { name: 'Slider position' })
      .element()
      .parentElement?.querySelector('[class*="grip"]')
    expect(grip?.getAttribute('aria-hidden')).toBe('true')
    const icons = grip?.querySelectorAll('svg') ?? []
    expect(icons).toHaveLength(2)
    for (const icon of icons) expect(icon.getAttribute('aria-hidden')).toBe('true')
  })

  it('takes the pointer on the divider only, not on the rest of the box', async () => {
    await render(<Stage />)
    const box = page.getByTestId('stage').element().getBoundingClientRect()
    const thumb = page.getByRole('slider', { name: 'Slider position' }).element().parentElement!
    const at = (x: number, y: number) =>
      document.elementFromPoint(box.left + box.width * x, box.top + box.height * y)
    // On the line and the grip: the thumb.
    expect(thumb.contains(at(0.5, 0.5))).toBe(true)
    expect(thumb.contains(at(0.5, 0.1))).toBe(true)
    // Anywhere else: not the slider (the stage itself, or whatever is under it).
    for (const [x, y] of [
      [0.05, 0.05],
      [0.95, 0.95],
      [0.2, 0.5],
      [0.8, 0.5],
    ] as const) {
      expect(at(x, y)?.closest('[role="slider"], [class*="control"]')).toBeNull()
    }
  })

  it('moves when the handle is dragged', async () => {
    await render(<Stage />)
    const slider = page.getByRole('slider', { name: 'Slider position' })
    const box = page.getByTestId('stage').element().getBoundingClientRect()
    // The divider starts at the middle of the box; a drag from there moves it.
    await userEvent.dragAndDrop(page.getByTestId('stage'), page.getByTestId('stage'), {
      sourcePosition: { x: box.width * 0.5, y: box.height * 0.5 },
      targetPosition: { x: box.width * 0.8, y: box.height * 0.2 },
    })
    await expect
      .poll(() => Number(slider.element().getAttribute('aria-valuenow')))
      .toBeGreaterThan(70)
  })

  it('does not move on a click or a drag elsewhere on the box', async () => {
    await render(<Stage />)
    const slider = page.getByRole('slider', { name: 'Slider position' })
    const stage = page.getByTestId('stage')
    await userEvent.click(stage, { position: { x: 40, y: 100 } })
    await userEvent.dragAndDrop(stage, stage, {
      sourcePosition: { x: 40, y: 40 },
      targetPosition: { x: 120, y: 120 },
    })
    await expect.element(slider).toHaveAttribute('aria-valuenow', '50')
  })

  it('is reached with Tab', async () => {
    await render(<Stage />)
    await userEvent.tab()
    await expect.element(page.getByRole('slider', { name: 'Slider position' })).toHaveFocus()
  })
})
