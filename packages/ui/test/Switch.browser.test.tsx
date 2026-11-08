import { expect, it, describe, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Switch } from '../src/index.ts'

describe('Switch', () => {
  it('is a switch named by its label', async () => {
    await render(<Switch label="Auto-approve" description="On the default branch." />)
    const sw = page.getByRole('switch', { name: /Auto-approve/ })
    await expect.element(sw).toBeInTheDocument()
    await expect.element(sw).toHaveAttribute('aria-checked', 'false')
  })

  it('toggles with Space and with a click, reporting each change', async () => {
    const onCheckedChange = vi.fn<(checked: boolean) => void>()
    await render(<Switch label="Auto-approve" onCheckedChange={onCheckedChange} />)
    const sw = page.getByRole('switch', { name: 'Auto-approve' })
    await userEvent.tab()
    await expect.element(sw).toHaveFocus()
    await userEvent.keyboard(' ')
    await expect.element(sw).toHaveAttribute('aria-checked', 'true')
    await sw.click()
    await expect.element(sw).toHaveAttribute('aria-checked', 'false')
    expect(onCheckedChange.mock.calls.map(([checked]) => checked)).toEqual([true, false])
  })

  it('does not toggle when disabled', async () => {
    await render(<Switch label="Locked" disabled />)
    await expect
      .element(page.getByRole('switch', { name: 'Locked' }))
      .toHaveAttribute('aria-disabled', 'true')
  })
})
