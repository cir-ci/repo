import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { SaveViewDialog } from '#features/views/SaveViewDialog.tsx'
import { renderPage } from '#test/support/render.tsx'

function show(over: Partial<SaveViewDialog.Props> = {}) {
  const onSave = vi.fn<(name: string) => void>()
  const onCancel = vi.fn<() => void>()
  const ready = renderPage(
    <SaveViewDialog
      open
      filters={{ review: 'pending', branch: 'main' }}
      pending={false}
      onCancel={onCancel}
      onSave={onSave}
      {...over}
    />,
  )
  return { ready, onSave, onCancel }
}

const dialog = () => page.getByRole('dialog', { name: 'Save view' })

describe('SaveViewDialog', () => {
  it('summarises the filters it saves', async () => {
    await show().ready
    await expect.element(page.getByText(/Status: Needs review/)).toBeVisible()
    await expect.element(page.getByText(/Branch: main/)).toBeVisible()
  })

  it('asks for a name when it is blank, and does not save', async () => {
    const { ready, onSave } = show()
    await ready
    await dialog().getByRole('textbox', { name: 'Name' }).fill('   ')
    await dialog().getByRole('button', { name: 'Save view' }).click()
    await expect.element(page.getByText(/Give the view a name\./)).toBeVisible()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves the trimmed name', async () => {
    const { ready, onSave } = show()
    await ready
    await dialog().getByRole('textbox', { name: 'Name' }).fill('  Waiting on me ')
    await dialog().getByRole('button', { name: 'Save view' }).click()
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Waiting on me')
  })

  it('shows the server’s refusal under the name', async () => {
    await show({ error: 'You already have a view with that name' }).ready
    await expect.element(page.getByText(/You already have a view with that name/)).toBeVisible()
  })

  it('cancels', async () => {
    const { ready, onCancel } = show()
    await ready
    await dialog().getByRole('button', { name: 'Cancel' }).click()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
