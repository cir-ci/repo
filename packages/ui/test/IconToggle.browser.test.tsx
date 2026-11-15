import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { IconToggle } from '#src/index.ts'

function Harness() {
  const [pressed, setPressed] = useState(false)
  return (
    <IconToggle label="Draw a region" pressed={pressed} onPressedChange={setPressed}>
      <span aria-hidden="true">+</span>
    </IconToggle>
  )
}

describe('IconToggle', () => {
  it('is a named button that is pressed or not, by click and by keyboard', async () => {
    await render(<Harness />)
    const button = page.getByRole('button', { name: 'Draw a region' })
    await expect.element(button).toHaveAttribute('aria-pressed', 'false')
    await button.click()
    await expect.element(button).toHaveAttribute('aria-pressed', 'true')
    await expect.element(button).toHaveAttribute('data-pressed')
    await userEvent.keyboard(' ')
    await expect.element(button).toHaveAttribute('aria-pressed', 'false')
  })
})
