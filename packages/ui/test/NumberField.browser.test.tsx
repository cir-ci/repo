import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { NumberField } from '#src/index.ts'

const field = () => page.getByRole('textbox', { name: 'Keep for' })

describe('NumberField', () => {
  it('is named by its label, is 32px high and shows a unit', async () => {
    await render(<NumberField label="Keep for" defaultValue={30} unit="days" />)
    await expect.element(field()).toHaveValue('30')
    await expect.element(page.getByText('days')).toBeVisible()
    const group = field().element().parentElement
    expect(group && getComputedStyle(group).height).toBe('32px')
  })

  it('reports typing as numbers', async () => {
    const onValueChange = vi.fn<(value: number | null) => void>()
    await render(<NumberField label="Keep for" onValueChange={onValueChange} />)
    await field().fill('42')
    await expect.poll(() => onValueChange).toHaveBeenLastCalledWith(42, expect.anything())
  })

  it('steps with the buttons and the arrow keys', async () => {
    await render(<NumberField label="Keep for" defaultValue={10} step={5} />)
    await page.getByRole('button', { name: 'Increase' }).click()
    await expect.element(field()).toHaveValue('15')
    await page.getByRole('button', { name: 'Decrease' }).click()
    await page.getByRole('button', { name: 'Decrease' }).click()
    await expect.element(field()).toHaveValue('5')
    field().element().focus()
    await userEvent.keyboard('{ArrowUp}')
    await expect.element(field()).toHaveValue('10')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    await expect.element(field()).toHaveValue('0')
  })

  it('clamps to min and max, on the buttons and on a typed value', async () => {
    await render(<NumberField label="Keep for" defaultValue={2} min={1} max={3} />)
    await page.getByRole('button', { name: 'Decrease' }).click()
    await expect.element(field()).toHaveValue('1')
    await expect.element(page.getByRole('button', { name: 'Decrease' })).toBeDisabled()
    await field().fill('99')
    await userEvent.tab()
    await expect.element(field()).toHaveValue('3')
  })

  it('puts its value in FormData under its name', async () => {
    await render(
      <form aria-label="f">
        <NumberField label="Keep for" name="days" defaultValue={7} />
      </form>,
    )
    await field().fill('12')
    await userEvent.tab()
    const form = page.getByRole('form', { name: 'f' }).element()
    if (!(form instanceof HTMLFormElement)) throw new Error('not a form')
    expect(new FormData(form).get('days')).toBe('12')
  })

  it('keeps decimals', async () => {
    await render(<NumberField label="Keep for" defaultValue={0.0001} step="any" />)
    await expect.element(field()).toHaveValue('0.0001')
  })

  it('shows the error instead of the description, and is invalid', async () => {
    await render(<NumberField label="Keep for" description="Help" error="Too long" />)
    await expect.element(page.getByText('Too long')).toBeVisible()
    await expect.element(page.getByText('Help')).not.toBeInTheDocument()
    await expect.element(field()).toHaveAttribute('aria-invalid', 'true')
    await expect.element(field()).toHaveAccessibleDescription('Too long')
  })

  it('is valid without an error, and describes itself with the description', async () => {
    await render(<NumberField label="Keep for" description="Days." />)
    await expect.element(field()).not.toHaveAttribute('aria-invalid')
    await expect.element(field()).toHaveAccessibleDescription('Days.')
  })

  it('disables the field and its buttons', async () => {
    await render(<NumberField label="Keep for" defaultValue={1} disabled />)
    await expect.element(field()).toBeDisabled()
    await expect.element(page.getByRole('button', { name: 'Increase' })).toBeDisabled()
  })
})
