import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Button, Popover, TextField } from '#src/index.ts'

function Harness() {
  return (
    <Popover trigger={<Button>Project</Button>} label="Switch project">
      <Button>First</Button>
      <Button>Second</Button>
    </Popover>
  )
}

describe('Popover', () => {
  it('opens a named dialog from its trigger and Tab moves through its content', async () => {
    await render(<Harness />)
    const trigger = page.getByRole('button', { name: 'Project' })
    await trigger.click()
    await expect.element(page.getByRole('dialog', { name: 'Switch project' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'First' })).toHaveFocus()
    await userEvent.tab()
    await expect.element(page.getByRole('button', { name: 'Second' })).toHaveFocus()
  })
})

describe('focus rings', () => {
  it('a text field keeps a 2px ring when focused by keyboard', async () => {
    await render(
      <>
        <Button>Before</Button>
        <TextField label="Name" />
      </>,
    )
    await page.getByRole('button', { name: 'Before' }).click()
    await userEvent.tab()
    const input = page.getByRole('textbox', { name: 'Name' })
    await expect.element(input).toHaveFocus()
    const style = getComputedStyle(input.element())
    expect(style.outlineStyle).toBe('solid')
    expect(style.outlineWidth).toBe('2px')
    expect(style.outlineOffset).toBe('2px')
  })
})
