import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Collapsible } from '../src/index.ts'

describe('Collapsible', () => {
  it('is a button with aria-expanded that shows and hides its panel', async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>()
    await render(
      <Collapsible title="Unchanged" count={14} onOpenChange={onOpenChange}>
        <p>Row content</p>
      </Collapsible>,
    )
    const trigger = page.getByRole('button', { name: /Unchanged/ })
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
    // A closed panel is not in the DOM.
    await expect.element(page.getByText('Row content')).not.toBeInTheDocument()
    await trigger.click()
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect.element(page.getByText('Row content')).toBeVisible()
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    await trigger.click()
    await expect.element(page.getByText('Row content')).not.toBeInTheDocument()
  })

  it('shows its count in the name', async () => {
    await render(
      <Collapsible title="Unchanged" count={14}>
        x
      </Collapsible>,
    )
    await expect.element(page.getByRole('button', { name: 'Unchanged 14' })).toBeInTheDocument()
  })

  it('toggles with Enter and Space and can start open', async () => {
    await render(
      <Collapsible title="Changed" defaultOpen>
        <p>Row content</p>
      </Collapsible>,
    )
    const trigger = page.getByRole('button', { name: 'Changed' })
    await expect.element(page.getByText('Row content')).toBeVisible()
    await userEvent.tab()
    await expect.element(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByText('Row content')).not.toBeInTheDocument()
    await userEvent.keyboard(' ')
    await expect.element(page.getByText('Row content')).toBeVisible()
  })
})
