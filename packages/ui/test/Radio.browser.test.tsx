import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Radio, RadioGroup } from '#src/index.ts'

function Harness({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('light')
  return (
    <>
      <button type="button">before</button>
      <RadioGroup
        label="Theme"
        value={value}
        onValueChange={(next) => {
          setValue(next)
          onChange?.(next)
        }}
      >
        <Radio value="system">System</Radio>
        <Radio value="light">Light</Radio>
        <Radio value="dark">Dark</Radio>
      </RadioGroup>
      <button type="button">after</button>
    </>
  )
}

describe('RadioGroup and Radio', () => {
  it('is a named radiogroup with one radio checked', async () => {
    await render(<Harness />)
    await expect.element(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible()
    await expect.element(page.getByRole('radio', { name: 'Light' })).toBeChecked()
    await expect.element(page.getByRole('radio', { name: 'Dark' })).not.toBeChecked()
  })

  it('chooses on click', async () => {
    const onChange = vi.fn<(value: string) => void>()
    await render(<Harness onChange={onChange} />)
    await page.getByRole('radio', { name: 'Dark' }).click()
    await expect.element(page.getByRole('radio', { name: 'Dark' })).toBeChecked()
    expect(onChange).toHaveBeenCalledWith('dark')
  })

  it('keeps one radio in the Tab order and roves with the arrow keys, choosing as it goes', async () => {
    await render(<Harness />)
    // Tab enters the group at the checked radio, and the next Tab leaves it.
    await userEvent.click(page.getByRole('button', { name: 'before' }))
    await userEvent.tab()
    await expect.element(page.getByRole('radio', { name: 'Light' })).toHaveFocus()
    await userEvent.tab()
    await expect.element(page.getByRole('button', { name: 'after' })).toHaveFocus()
    await userEvent.tab({ shift: true })
    await expect.element(page.getByRole('radio', { name: 'Light' })).toHaveFocus()

    await userEvent.keyboard('{ArrowRight}')
    await expect.element(page.getByRole('radio', { name: 'Dark' })).toHaveFocus()
    await expect.element(page.getByRole('radio', { name: 'Dark' })).toBeChecked()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(page.getByRole('radio', { name: 'System' })).toBeChecked()
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(page.getByRole('radio', { name: 'Dark' })).toBeChecked()
  })

  it('marks the checked radio for styling', async () => {
    await render(<Harness />)
    await expect.element(page.getByRole('radio', { name: 'Light' })).toHaveAttribute('data-checked')
    await expect
      .element(page.getByRole('radio', { name: 'Dark' }))
      .not.toHaveAttribute('data-checked')
  })
})
