import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Button, ConfirmDialog } from '#src/index.ts'

function Harness(props: { confirmText?: string; onConfirm?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete web-app?"
        description="This can’t be undone."
        confirmText={props.confirmText}
        onConfirm={() => {
          props.onConfirm?.()
          setOpen(false)
        }}
      />
    </>
  )
}

describe('ConfirmDialog', () => {
  it('is an alertdialog named by its title and described by its description', async () => {
    await render(<Harness />)
    await page.getByRole('button', { name: 'Open' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Delete web-app?' })
    await expect.element(dialog).toBeVisible()
    await expect.element(dialog).toHaveAccessibleDescription('This can’t be undone.')
  })

  it('confirms with the destructive button and focus starts on Cancel', async () => {
    const onConfirm = vi.fn<() => void>()
    await render(<Harness onConfirm={onConfirm} />)
    await page.getByRole('button', { name: 'Open' }).click()
    await expect.element(page.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await page.getByRole('button', { name: 'Delete' }).click()
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('Cancel and Escape close it without confirming', async () => {
    const onConfirm = vi.fn<() => void>()
    await render(<Harness onConfirm={onConfirm} />)
    const opener = page.getByRole('button', { name: 'Open' })
    await opener.click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
    await opener.click()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect.element(opener).toHaveFocus()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('does not close on a click outside', async () => {
    await page.viewport(800, 600)
    await render(<Harness />)
    await page.getByRole('button', { name: 'Open' }).click()
    await expect.element(page.getByRole('alertdialog')).toBeVisible()
    await userEvent.click(document.body, { position: { x: 4, y: 4 } })
    await expect.element(page.getByRole('alertdialog')).toBeVisible()
  })

  it('with confirmText: disabled until typed exactly, and Enter only then confirms', async () => {
    const onConfirm = vi.fn<() => void>()
    await render(<Harness confirmText="web-app" onConfirm={onConfirm} />)
    await page.getByRole('button', { name: 'Open' }).click()
    const input = page.getByRole('textbox', { name: 'Type web-app to confirm' })
    await expect.element(input).toHaveFocus()
    const confirm = page.getByRole('button', { name: 'Delete' })
    await expect.element(confirm).toBeDisabled()

    await input.fill('web-ap')
    await expect.element(confirm).toBeDisabled()
    await userEvent.keyboard('{Enter}')
    expect(onConfirm).not.toHaveBeenCalled()

    await input.fill('web-app')
    await expect.element(confirm).toBeEnabled()
    await userEvent.keyboard('{Enter}')
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('forgets the typed phrase when closed', async () => {
    await render(<Harness confirmText="web-app" />)
    const opener = page.getByRole('button', { name: 'Open' })
    await opener.click()
    await page.getByRole('textbox').fill('web-app')
    await userEvent.keyboard('{Escape}')
    await opener.click()
    await expect.element(page.getByRole('textbox')).toHaveValue('')
    await expect.element(page.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })
})
