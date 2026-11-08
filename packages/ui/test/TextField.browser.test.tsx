import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { TextField } from '../src/index.ts'

describe('TextField', () => {
  it('names the input by its label and passes input props through', async () => {
    await render(<TextField label="Name" name="name" placeholder="Acme" />)
    const input = page.getByRole('textbox', { name: 'Name' })
    await expect.element(input).toHaveAttribute('name', 'name')
    await expect.element(input).toHaveAttribute('placeholder', 'Acme')
    expect(getComputedStyle(input.element()).height).toBe('32px')
  })

  it('describes the input with its description', async () => {
    await render(<TextField label="Name" description="Usually the repository’s name." />)
    await expect
      .element(
        page.getByRole('textbox', { name: 'Name', description: 'Usually the repository’s name.' }),
      )
      .toBeInTheDocument()
  })

  it('shows the error instead of the description, with aria-invalid', async () => {
    await render(<TextField label="Name" description="Help text" error="Enter a name" />)
    const input = page.getByRole('textbox', { name: 'Name' })
    await expect.element(input).toBeInvalid()
    await expect.element(input).toHaveAttribute('aria-invalid', 'true')
    await expect.element(page.getByText('Enter a name')).toBeVisible()
    await expect.element(page.getByText('Help text')).not.toBeInTheDocument()
    await expect.element(input).toHaveAccessibleDescription('Enter a name')
  })

  it('is not invalid without an error', async () => {
    await render(<TextField label="Name" />)
    await expect
      .element(page.getByRole('textbox', { name: 'Name' }))
      .not.toHaveAttribute('aria-invalid')
  })

  it('reports typing', async () => {
    const onChange = vi.fn<() => void>()
    await render(<TextField label="Name" onChange={onChange} />)
    const input = page.getByRole('textbox', { name: 'Name' })
    await input.fill('abc')
    await expect.element(input).toHaveValue('abc')
    expect(onChange).toHaveBeenCalled()
  })

  it('submits its form on Enter', async () => {
    const onSubmit = vi.fn<(e: { preventDefault: () => void }) => void>((e) => e.preventDefault())
    await render(
      <form onSubmit={onSubmit}>
        <TextField label="Name" name="name" />
        <button type="submit">Go</button>
      </form>,
    )
    await page.getByRole('textbox', { name: 'Name' }).fill('Acme')
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
