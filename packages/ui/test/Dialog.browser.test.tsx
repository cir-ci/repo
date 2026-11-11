import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Button, Dialog, TextField } from '#src/index.ts'

function Harness(props: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          props.onOpenChange?.(next)
          setOpen(next)
        }}
        title="New organization"
        description="Organizations own projects."
        actions={<Button variant="primary">Create</Button>}
      >
        <TextField label="Name" />
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  it('is a modal dialog named by its title and described by its description', async () => {
    await render(<Harness />)
    await page.getByRole('button', { name: 'Open' }).click()
    const dialog = page.getByRole('dialog', { name: 'New organization' })
    await expect.element(dialog).toBeVisible()
    await expect.element(dialog).toHaveAccessibleDescription('Organizations own projects.')
  })

  it('renders in a portal on document.body with its content and footer', async () => {
    await page.viewport(800, 600)
    const { container } = await render(<Harness />)
    await page.getByRole('button', { name: 'Open' }).click()
    const dialog = page.getByRole('dialog')
    await expect.element(dialog).toBeVisible()
    expect(container.contains(dialog.element())).toBe(false)
    expect(document.body.contains(dialog.element())).toBe(true)
    await expect.element(page.getByRole('textbox', { name: 'Name' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Create' })).toBeVisible()
    expect(getComputedStyle(dialog.element()).width).toBe('440px')
  })

  it('renders nothing while closed', async () => {
    await render(<Dialog open={false} onOpenChange={() => {}} title="Hidden" />)
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on Escape and returns focus to what opened it', async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>()
    await render(<Harness onOpenChange={onOpenChange} />)
    const opener = page.getByRole('button', { name: 'Open' })
    await opener.click()
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => onOpenChange).toHaveBeenLastCalledWith(false)
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await expect.element(opener).toHaveFocus()
  })

  it('closes with its close button', async () => {
    await render(<Harness />)
    await page.getByRole('button', { name: 'Open' }).click()
    await page.getByRole('button', { name: 'Close' }).click()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('moves focus into the dialog and keeps Tab inside it', async () => {
    await render(<Harness />)
    await page.getByRole('button', { name: 'Open' }).click()
    const dialog = page.getByRole('dialog')
    await expect.element(dialog).toBeVisible()
    for (let i = 0; i < 6; i++) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each Tab depends on the previous one
      await userEvent.tab()
      // oxlint-disable-next-line eslint/no-await-in-loop -- the check follows its Tab
      await expect.poll(() => dialog.element().contains(document.activeElement)).toBe(true)
    }
  })
})
