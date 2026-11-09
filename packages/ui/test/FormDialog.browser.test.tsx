import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { FormDialog, TextField } from '#src/index.ts'

function setup(props: Partial<FormDialog.Props> = {}) {
  const onClose = vi.fn<() => void>()
  const onSubmit = vi.fn<NonNullable<FormDialog.Props['onSubmit']>>()
  const view = render(
    <FormDialog
      open
      title="Name it"
      submitLabel="Save"
      onClose={onClose}
      onSubmit={onSubmit}
      {...props}
    >
      <TextField label="Name" name="name" />
    </FormDialog>,
  )
  return { onClose, onSubmit, view }
}

describe('FormDialog', () => {
  it('submits the form from the footer button and stops the browser submit', async () => {
    const { onSubmit } = setup()
    await userEvent.fill(page.getByRole('textbox', { name: 'Name' }), 'x')
    await page.getByRole('button', { name: 'Save' }).click()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[0].defaultPrevented).toBe(true)
  })

  it('submits with Enter in a field', async () => {
    const { onSubmit } = setup()
    await userEvent.fill(page.getByRole('textbox', { name: 'Name' }), 'x')
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('Cancel and Escape both call onClose', async () => {
    const { onClose } = setup()
    await page.getByRole('button', { name: 'Cancel' }).click()
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('uses onCancel for Cancel when given', async () => {
    const onCancel = vi.fn<() => void>()
    const { onClose } = setup({ onCancel })
    await page.getByRole('button', { name: 'Cancel' }).click()
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows the submit button as loading while pending', async () => {
    setup({ pending: true, submitLabel: 'Saving' })
    await expect.element(page.getByRole('button', { name: 'Saving' })).toBeVisible()
  })
})
