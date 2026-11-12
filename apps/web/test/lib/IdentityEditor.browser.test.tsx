import { Avatar, Button } from '@circi/ui'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { IdentityEditor } from '#lib/IdentityEditor.tsx'
import { renderPage } from '#test/support/render.tsx'
import { openDialogs } from '#test/support/toast.ts'

const avatar = (
  <Avatar type="workspace" slug="acme" name="Acme" picture={null} size={40} aria-hidden />
)
const idle = { status: 'idle' as const, error: null, reset: () => {} }

function editor(over: Partial<IdentityEditor.Props> = {}) {
  const onCommit = vi.fn<(next: string) => void>()
  const ui = (
    <IdentityEditor
      avatar={avatar}
      buttonLabel="Change picture"
      panelLabel="Picture"
      panel={<Button onClick={() => {}}>Upload picture</Button>}
      name="name"
      saved="Acme"
      mutation={idle}
      validate={(next) => (next ? null : 'Enter a name')}
      onCommit={onCommit}
      {...over}
    />
  )
  return { ui, onCommit }
}

describe('IdentityEditor', () => {
  it('shows the avatar button and the name field side by side', async () => {
    await renderPage(editor().ui)
    const button = page.getByRole('button', { name: 'Change picture' })
    const input = page.getByRole('textbox', { name: 'Name' })
    await expect.element(input).toHaveValue('Acme')
    const a = button.element().getBoundingClientRect()
    const b = input.element().getBoundingClientRect()
    expect(b.left).toBeGreaterThanOrEqual(a.right)
    expect(Math.abs(a.top + a.height / 2 - (b.top + b.height / 2))).toBeLessThan(6)
  })

  it('opens the panel on click and closes it with Escape, returning focus to the avatar', async () => {
    await renderPage(editor().ui)
    const button = page.getByRole('button', { name: 'Change picture' })
    await button.click()
    await expect.element(page.getByRole('dialog', { name: 'Picture' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Upload picture' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => openDialogs()).toHaveLength(0)
    await expect.element(button).toHaveFocus()
  })

  it('opens from the keyboard with Enter and Space', async () => {
    await renderPage(editor().ui)
    const button = page.getByRole('button', { name: 'Change picture' })
    await userEvent.tab()
    await expect.element(button).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByRole('dialog', { name: 'Picture' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => openDialogs()).toHaveLength(0)
    await userEvent.keyboard(' ')
    await expect.element(page.getByRole('dialog', { name: 'Picture' })).toBeVisible()
  })

  it('saves the name on Enter and on blur, and refuses an empty one', async () => {
    const { ui, onCommit } = editor()
    await renderPage(ui)
    const input = page.getByRole('textbox', { name: 'Name' })
    await input.fill('Acme Inc')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => onCommit).toHaveBeenLastCalledWith('Acme Inc')
    await input.fill('Acme 2')
    await userEvent.tab()
    await expect.poll(() => onCommit).toHaveBeenLastCalledWith('Acme 2')
    await input.fill('')
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByText('Enter a name')).toBeVisible()
    expect(onCommit).toHaveBeenCalledTimes(2)
  })

  it('is the avatar and the plain name, with nothing to click, when it cannot be edited', async () => {
    await renderPage(editor({ canEdit: false }).ui)
    await expect.element(page.getByText('Acme', { exact: true })).toBeVisible()
    expect(page.getByRole('button').elements()).toHaveLength(0)
    expect(page.getByRole('textbox').elements()).toHaveLength(0)
  })
})
