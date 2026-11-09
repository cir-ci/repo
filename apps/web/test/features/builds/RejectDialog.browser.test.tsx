import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { RejectDialog } from '#features/builds/RejectDialog.tsx'
import { renderPage } from '#test/support/render.tsx'

function show(over: Partial<RejectDialog.Props> = {}) {
  const onReject = vi.fn<(reason: string) => void>()
  const onCancel = vi.fn<() => void>()
  const ready = renderPage(
    <RejectDialog
      open
      subject="checkout/summary"
      pending={false}
      onCancel={onCancel}
      onReject={onReject}
      {...over}
    />,
  )
  return { ready, onReject, onCancel }
}

const dialog = () => page.getByRole('dialog', { name: 'Reject checkout/summary?' })

describe('RejectDialog', () => {
  it('names what is rejected and asks for a reason', async () => {
    await show().ready
    await expect.element(dialog()).toBeVisible()
    await expect.element(dialog().getByRole('textbox', { name: 'Reason' })).toBeRequired()
  })

  it('puts the cursor in the Reason box when it opens, so the reason can be typed at once', async () => {
    await show().ready
    await expect.element(dialog().getByRole('textbox', { name: 'Reason' })).toHaveFocus()
    await userEvent.keyboard('Too tight')
    await expect.element(dialog().getByRole('textbox', { name: 'Reason' })).toHaveValue('Too tight')
  })

  it('refuses an empty or blank reason and says why', async () => {
    const { ready, onReject } = show()
    await ready
    const field = dialog().getByRole('textbox', { name: 'Reason' })
    await field.fill('   ')
    await dialog().getByRole('button', { name: 'Reject', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Say why you are rejecting it.')
    await expect.element(field).toBeInvalid()
    expect(onReject).not.toHaveBeenCalled()
  })

  it('sends the trimmed reason from the button', async () => {
    const { ready, onReject } = show()
    await ready
    await dialog().getByRole('textbox', { name: 'Reason' }).fill('  Button is clipped  ')
    await dialog().getByRole('button', { name: 'Reject', exact: true }).click()
    expect(onReject).toHaveBeenCalledExactlyOnceWith('Button is clipped')
  })

  it('sends the reason with the submit shortcut from the text field', async () => {
    const { ready, onReject } = show()
    await ready
    await dialog().getByRole('textbox', { name: 'Reason' }).fill('Wrong colour')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    expect(onReject).toHaveBeenCalledExactlyOnceWith('Wrong colour')
  })

  it('does not send while a rejection is pending', async () => {
    const { ready, onReject } = show({ pending: true })
    await ready
    await dialog().getByRole('textbox', { name: 'Reason' }).fill('Wrong colour')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    expect(onReject).not.toHaveBeenCalled()
  })

  it('cancels from the button and from Escape', async () => {
    const { ready, onCancel } = show()
    await ready
    await dialog().getByRole('button', { name: 'Cancel' }).click()
    expect(onCancel).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => onCancel.mock.calls.length).toBe(2)
  })
})
