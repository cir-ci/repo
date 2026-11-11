import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Checkbox, CheckboxGroup } from '#src/index.ts'

describe('Checkbox', () => {
  it('is a checkbox named by its label, 14×14, toggled by click and by Space', async () => {
    const onCheckedChange = vi.fn<(checked: boolean) => void>()
    await render(<Checkbox label="Notify me" onCheckedChange={onCheckedChange} />)
    const box = page.getByRole('checkbox', { name: 'Notify me' })
    await expect.element(box).not.toBeChecked()
    const style = getComputedStyle(box.element())
    expect([style.width, style.height]).toEqual(['14px', '14px'])
    await box.click()
    await expect.element(box).toBeChecked()
    await userEvent.keyboard(' ')
    await expect.element(box).not.toBeChecked()
    expect(onCheckedChange.mock.calls.map(([c]) => c)).toEqual([true, false])
  })

  it('toggles when its label text is clicked', async () => {
    await render(<Checkbox label="Notify me" />)
    await page.getByText('Notify me').click()
    await expect.element(page.getByRole('checkbox', { name: 'Notify me' })).toBeChecked()
  })

  it('is described by its description', async () => {
    await render(<Checkbox label="Notify me" description="By email." />)
    await expect
      .element(page.getByRole('checkbox', { name: 'Notify me' }))
      .toHaveAccessibleDescription('By email.')
  })

  it('does not toggle when disabled', async () => {
    await render(<Checkbox label="Notify me" disabled />)
    const box = page.getByRole('checkbox', { name: 'Notify me' })
    await expect.element(box).toHaveAttribute('data-disabled')
    await box.click({ force: true })
    await expect.element(box).not.toBeChecked()
  })

  it('can be mixed', async () => {
    await render(<Checkbox label="All" indeterminate />)
    await expect
      .element(page.getByRole('checkbox', { name: 'All' }))
      .toHaveAttribute('aria-checked', 'mixed')
  })
})

describe('CheckboxGroup', () => {
  it('is a group named by its legend holding the checked values', async () => {
    const onValueChange = vi.fn<(value: string[]) => void>()
    await render(
      <CheckboxGroup
        legend="Events"
        defaultValue={['build.complete']}
        onValueChange={onValueChange}
      >
        <Checkbox label="Build complete" value="build.complete" />
        <Checkbox label="Build approved" value="build.approved" />
      </CheckboxGroup>,
    )
    await expect.element(page.getByRole('group', { name: 'Events' })).toBeVisible()
    await expect.element(page.getByRole('checkbox', { name: 'Build complete' })).toBeChecked()
    await page.getByRole('checkbox', { name: 'Build approved' }).click()
    await expect
      .poll(() => onValueChange)
      .toHaveBeenLastCalledWith(['build.complete', 'build.approved'])
  })

  it('moves between checkboxes with Tab and toggles with Space', async () => {
    await render(
      <CheckboxGroup legend="Events">
        <Checkbox label="One" value="1" />
        <Checkbox label="Two" value="2" />
      </CheckboxGroup>,
    )
    await userEvent.tab()
    await expect.element(page.getByRole('checkbox', { name: 'One' })).toHaveFocus()
    await userEvent.tab()
    await expect.element(page.getByRole('checkbox', { name: 'Two' })).toHaveFocus()
    await userEvent.keyboard(' ')
    await expect.element(page.getByRole('checkbox', { name: 'Two' })).toBeChecked()
    await expect.element(page.getByRole('checkbox', { name: 'One' })).not.toBeChecked()
  })

  it('disables every checkbox when the group is disabled', async () => {
    await render(
      <CheckboxGroup legend="Events" disabled>
        <Checkbox label="One" value="1" />
      </CheckboxGroup>,
    )
    await expect
      .element(page.getByRole('checkbox', { name: 'One' }))
      .toHaveAttribute('data-disabled')
  })
})
