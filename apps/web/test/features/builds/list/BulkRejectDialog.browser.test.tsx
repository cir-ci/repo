import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { BulkRejectDialog } from '#features/builds/list/BulkRejectDialog.tsx'
import { renderPage } from '#test/support/render.tsx'

function show(over: Partial<BulkRejectDialog.Props> = {}) {
  const onReject = vi.fn<(reason: string) => void>()
  const onCancel = vi.fn<() => void>()
  const ready = renderPage(
    <BulkRejectDialog
      open
      count={3}
      pending={false}
      onCancel={onCancel}
      onReject={onReject}
      {...over}
    />,
  )
  return { ready, onReject, onCancel }
}

describe('BulkRejectDialog', () => {
  it('says how many builds are rejected', async () => {
    await show().ready
    await expect.element(page.getByRole('dialog', { name: 'Reject 3 builds?' })).toBeVisible()
  })

  it('uses the singular for one build', async () => {
    await show({ count: 1 }).ready
    await expect.element(page.getByRole('dialog', { name: 'Reject 1 build?' })).toBeVisible()
  })

  it('needs a reason: a blank one is refused with an alert', async () => {
    const { ready, onReject } = show()
    await ready
    await page.getByRole('textbox', { name: 'Reason' }).fill('  ')
    await page.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Say why you are rejecting them.')
    await expect.element(page.getByRole('textbox', { name: 'Reason' })).toBeInvalid()
    expect(onReject).not.toHaveBeenCalled()
  })

  it('sends the trimmed reason from the button and from the submit shortcut', async () => {
    const { ready, onReject } = show()
    await ready
    const field = page.getByRole('textbox', { name: 'Reason' })
    await field.fill(' Layout broke ')
    await page.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect.poll(() => onReject).toHaveBeenLastCalledWith('Layout broke')
    await field.fill('Spacing')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await expect.poll(() => onReject).toHaveBeenLastCalledWith('Spacing')
  })

  it('does not send twice while pending', async () => {
    const { ready, onReject } = show({ pending: true })
    await ready
    await page.getByRole('textbox', { name: 'Reason' }).fill('Spacing')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    expect(onReject).not.toHaveBeenCalled()
  })

  it('cancels from the button', async () => {
    const { ready, onCancel } = show()
    await ready
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect.poll(() => onCancel).toHaveBeenCalledTimes(1)
  })
})
