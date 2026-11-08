import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Select } from '#src/index.ts'

const ROLES = [
  { value: 'owner', label: 'Owner' },
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
]

describe('Select', () => {
  it('is a combobox named by its label, 32px high, showing the placeholder', async () => {
    await render(<Select label="Role" items={ROLES} placeholder="Pick a role" />)
    const trigger = page.getByRole('combobox', { name: 'Role' })
    await expect.element(trigger).toHaveTextContent('Pick a role')
    expect(getComputedStyle(trigger.element()).height).toBe('32px')
  })

  it('can hide its label visually and still be named by it', async () => {
    await render(<Select label="Role of Ada" hideLabel items={ROLES} defaultValue="member" />)
    const trigger = page.getByRole('combobox', { name: 'Role of Ada' })
    await expect.element(trigger).toBeVisible()
    const label = page.getByText('Role of Ada').element()
    const box = label.getBoundingClientRect()
    expect(box.width).toBeLessThanOrEqual(1)
    expect(box.height).toBeLessThanOrEqual(1)
    // The trigger doesn't gain a gap for the label.
    expect(trigger.element().getBoundingClientRect().height).toBe(32)
  })

  it('shows the selected item’s label', async () => {
    await render(<Select label="Role" items={ROLES} defaultValue="member" />)
    await expect.element(page.getByRole('combobox', { name: 'Role' })).toHaveTextContent('Member')
  })

  it('opens a listbox below the trigger, at least as wide as it', async () => {
    await page.viewport(800, 600)
    await render(
      <div style={{ width: 240 }}>
        <Select label="Role" items={ROLES} defaultValue="member" />
      </div>,
    )
    const trigger = page.getByRole('combobox', { name: 'Role' })
    await trigger.click()
    const listbox = page.getByRole('listbox')
    await expect.element(listbox).toBeVisible()
    expect(page.getByRole('option').elements()).toHaveLength(3)
    const t = trigger.element().getBoundingClientRect()
    const popup = listbox.element().closest('[data-slot="select-popup"]')
    expect(popup).not.toBeNull()
    const p = (popup ?? listbox.element()).getBoundingClientRect()
    // Not overlapping the trigger (alignItemWithTrigger is off).
    expect(p.top).toBeGreaterThanOrEqual(t.bottom)
    // Layout width: the popup scales in from 0.98 while it opens.
    expect(popup instanceof HTMLElement && popup.offsetWidth).toBeGreaterThanOrEqual(t.width - 1)
  })

  it('picks with the keyboard: arrows move, Enter chooses, focus returns to the trigger', async () => {
    const onValueChange = vi.fn<(value: string) => void>()
    await render(
      <Select label="Role" items={ROLES} defaultValue="owner" onValueChange={onValueChange} />,
    )
    const trigger = page.getByRole('combobox', { name: 'Role' })
    await userEvent.tab()
    await expect.element(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByRole('listbox')).toBeVisible()
    // The selected item starts highlighted; the arrow moves from it.
    await expect
      .element(page.getByRole('option', { name: 'Owner' }))
      .toHaveAttribute('data-highlighted')
    await userEvent.keyboard('{ArrowDown}')
    await expect
      .element(page.getByRole('option', { name: 'Member' }))
      .toHaveAttribute('data-highlighted')
    await userEvent.keyboard('{Enter}')
    expect(onValueChange).toHaveBeenLastCalledWith('member')
    await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveTextContent('Member')
    await expect.element(trigger).toHaveFocus()
  })

  it('closes on Escape without changing the value', async () => {
    const onValueChange = vi.fn<(value: string) => void>()
    await render(
      <Select label="Role" items={ROLES} defaultValue="owner" onValueChange={onValueChange} />,
    )
    await page.getByRole('combobox', { name: 'Role' }).click()
    await expect.element(page.getByRole('listbox')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('picks with the pointer', async () => {
    await render(<Select label="Role" items={ROLES} />)
    await page.getByRole('combobox', { name: 'Role' }).click()
    await page.getByRole('option', { name: 'Viewer' }).click()
    await expect.element(page.getByRole('combobox', { name: 'Role' })).toHaveTextContent('Viewer')
  })

  it('shows the error instead of the description and marks the control invalid', async () => {
    await render(<Select label="Role" items={ROLES} description="Help text" error="Pick a role" />)
    await expect
      .element(page.getByRole('combobox', { name: 'Role' }))
      .toHaveAttribute('data-invalid')
    await expect.element(page.getByText('Pick a role')).toBeVisible()
    await expect.element(page.getByText('Help text')).not.toBeInTheDocument()
  })

  it('describes the control with its description', async () => {
    await render(<Select label="Role" items={ROLES} description="What they may do." />)
    await expect
      .element(page.getByRole('combobox', { name: 'Role' }))
      .toHaveAccessibleDescription('What they may do.')
  })

  it('does not open when disabled', async () => {
    await render(<Select label="Role" items={ROLES} disabled />)
    const trigger = page.getByRole('combobox', { name: 'Role' })
    await expect.element(trigger).toHaveAttribute('data-disabled')
    await trigger.click({ force: true })
    await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
  })
})
