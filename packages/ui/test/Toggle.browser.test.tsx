import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Toggle } from '#src/index.ts'

function Harness({ onChange }: { onChange?: (pressed: boolean) => void }) {
  const [pressed, setPressed] = useState(false)
  return (
    <Toggle
      pressed={pressed}
      onPressedChange={(next) => {
        setPressed(next)
        onChange?.(next)
      }}
    >
      View as table
    </Toggle>
  )
}

describe('Toggle', () => {
  it('is a button that is pressed or not, and keeps its name in both states', async () => {
    await render(<Harness />)
    const button = page.getByRole('button', { name: 'View as table' })
    await expect.element(button).toHaveAttribute('aria-pressed', 'false')
    await button.click()
    await expect.element(button).toHaveAttribute('aria-pressed', 'true')
    await expect.element(button).toHaveAttribute('data-pressed')
    await button.click()
    await expect.element(button).toHaveAttribute('aria-pressed', 'false')
  })

  it('toggles from the keyboard with Space and Enter', async () => {
    const onChange = vi.fn<(pressed: boolean) => void>()
    await render(<Harness onChange={onChange} />)
    await userEvent.tab()
    await expect.element(page.getByRole('button', { name: 'View as table' })).toHaveFocus()
    await userEvent.keyboard(' ')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => onChange.mock.calls.map(([pressed]) => pressed)).toEqual([true, false])
  })
})
