import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { CheckedTextField } from '#lib/CheckedTextField.tsx'
import { renderPage } from '#test/support/render.tsx'

const idle: CheckedTextField.Props['mutation'] = { isPending: false, error: null, reset: () => {} }
const field = () => page.getByRole('textbox', { name: 'Display Name' })
const check = () => page.getByRole('button', { name: 'Save Display Name' })

/**
 * The field beside two buttons: "Refetch" stands in for a new saved value ("Acme Corp") arriving,
 * "Elsewhere" is somewhere else to move the focus to.
 */
function Harness(props: Partial<CheckedTextField.Props>) {
  const [saved, setSaved] = useState('Acme')
  return (
    <>
      <CheckedTextField
        label="Display Name"
        saved={saved}
        mutation={idle}
        onCommit={() => {}}
        {...props}
      />
      <button type="button" onClick={() => setSaved('Acme Corp')}>
        Refetch
      </button>
      <button type="button">Elsewhere</button>
    </>
  )
}

describe('CheckedTextField', () => {
  it('shows the ✓ only while the text differs from the saved one', async () => {
    await renderPage(<Harness />)
    await expect.element(field()).toHaveValue('Acme')
    expect(check().elements()).toHaveLength(0)
    await field().fill('Acme Inc')
    await expect.element(check()).toBeVisible()
    await expect.element(check()).toBeEnabled()
    await field().fill('Acme')
    await expect.element(check()).not.toBeInTheDocument()
    // Spaces around the saved text are not a change.
    await field().fill('  Acme ')
    await expect.element(check()).not.toBeInTheDocument()
  })

  it('commits the trimmed text with the ✓', async () => {
    const onCommit = vi.fn<(next: string) => void>()
    await renderPage(<Harness onCommit={onCommit} />)
    await field().fill('  Acme Inc ')
    expect(onCommit).not.toHaveBeenCalled()
    await check().click()
    await expect.poll(() => onCommit).toHaveBeenCalledExactlyOnceWith('Acme Inc')
  })

  it('commits on Enter', async () => {
    const onCommit = vi.fn<(next: string) => void>()
    await renderPage(<Harness onCommit={onCommit} />)
    await field().fill('Acme Inc')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => onCommit).toHaveBeenCalledExactlyOnceWith('Acme Inc')
  })

  it('commits nothing when Enter is pressed on unchanged text', async () => {
    const onCommit = vi.fn<(next: string) => void>()
    await renderPage(<Harness onCommit={onCommit} />)
    await field().click()
    await userEvent.keyboard('{Enter}')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits nothing when the field is left, and keeps the text and the ✓', async () => {
    const onCommit = vi.fn<(next: string) => void>()
    await renderPage(<Harness onCommit={onCommit} />)
    await field().fill('Acme Inc')
    await page.getByRole('button', { name: 'Elsewhere' }).click()
    expect(onCommit).not.toHaveBeenCalled()
    await expect.element(field()).toHaveValue('Acme Inc')
    await expect.element(check()).toBeVisible()
  })

  it('puts the saved text back on Escape and hides the ✓', async () => {
    const onCommit = vi.fn<(next: string) => void>()
    await renderPage(<Harness onCommit={onCommit} />)
    await field().fill('Acme Inc')
    await expect.element(check()).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(field()).toHaveValue('Acme')
    await expect.element(check()).not.toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('resets a failed save on Escape', async () => {
    const reset = vi.fn<() => void>()
    await renderPage(<Harness mutation={{ isPending: false, error: new Error('Nope'), reset }} />)
    await field().fill('Acme Inc')
    reset.mockClear()
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => reset).toHaveBeenCalled()
  })

  it('refuses text that validate rejects, shows its message and sends nothing', async () => {
    const onCommit = vi.fn<(next: string) => void>()
    await renderPage(
      <Harness onCommit={onCommit} validate={(next) => (next.includes('!') ? 'No bangs' : null)} />,
    )
    await field().fill('Acme!')
    await check().click()
    await expect.element(page.getByText('No bangs')).toBeVisible()
    expect(onCommit).not.toHaveBeenCalled()
    // Typing again clears the message, and valid text goes through.
    await field().fill('Acme Inc')
    await expect.element(page.getByText('No bangs')).not.toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => onCommit).toHaveBeenCalledExactlyOnceWith('Acme Inc')
  })

  it('shows a failed save on the field', async () => {
    await renderPage(
      <Harness
        mutation={{ isPending: false, error: new Error('Name is too long'), reset: () => {} }}
      />,
    )
    await expect.element(page.getByText('Name is too long')).toBeVisible()
    await expect.element(field()).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows the dirty description in place of the description only while the text differs', async () => {
    await renderPage(<Harness description="Plain help" dirtyDescription="Careful: it changes" />)
    await expect.element(page.getByText('Plain help')).toBeVisible()
    await field().fill('Acme Inc')
    await expect.element(page.getByText('Careful: it changes')).toBeVisible()
    await expect.element(page.getByText('Plain help')).not.toBeInTheDocument()
    await field().fill('Acme')
    await expect.element(page.getByText('Plain help')).toBeVisible()
  })

  it('disables the ✓ while the save is pending', async () => {
    await renderPage(<Harness mutation={{ isPending: true, error: null, reset: () => {} }} />)
    await field().fill('Acme Inc')
    await expect.element(check()).toBeVisible()
    await expect.element(check()).toBeDisabled()
  })

  it('replaces the draft when a new saved value arrives', async () => {
    await renderPage(<Harness />)
    await field().fill('Half an edit')
    await page.getByRole('button', { name: 'Refetch' }).click()
    await expect.element(field()).toHaveValue('Acme Corp')
    await expect.element(check()).not.toBeInTheDocument()
  })
})
