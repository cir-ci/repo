import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { TextArea } from '#src/index.ts'

describe('TextArea', () => {
  it('names the textarea by its label and passes textarea props through', async () => {
    await render(<TextArea label="Reason" rows={4} placeholder="Why?" />)
    const field = page.getByRole('textbox', { name: 'Reason' })
    await expect.element(field).toHaveAttribute('rows', '4')
    await expect.element(field).toHaveAttribute('placeholder', 'Why?')
    expect(field.element().tagName).toBe('TEXTAREA')
  })

  it('describes the field with its description', async () => {
    await render(<TextArea label="Reason" description="Shown to the author." />)
    await expect
      .element(page.getByRole('textbox', { name: 'Reason' }))
      .toHaveAccessibleDescription('Shown to the author.')
  })

  it('shows the error instead of the description, announced, with aria-invalid', async () => {
    await render(<TextArea label="Reason" description="Help text" error="Say why." />)
    const field = page.getByRole('textbox', { name: 'Reason' })
    await expect.element(field).toBeInvalid()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Say why.')
    await expect.element(page.getByText('Help text')).not.toBeInTheDocument()
    await expect.element(field).toHaveAccessibleDescription('Say why.')
  })

  it('is not invalid without an error, and reports typing', async () => {
    const onChange = vi.fn<() => void>()
    await render(<TextArea label="Reason" onChange={onChange} />)
    const field = page.getByRole('textbox', { name: 'Reason' })
    await expect.element(field).not.toHaveAttribute('aria-invalid')
    await field.fill('abc')
    await expect.element(field).toHaveValue('abc')
    expect(onChange).toHaveBeenCalled()
  })

  it('hides the label visually but keeps it as the name, and hands the element out for focus', async () => {
    const ref = createRef<HTMLTextAreaElement>()
    await render(<TextArea label="Reason" hideLabel inputRef={ref} />)
    const field = page.getByRole('textbox', { name: 'Reason' })
    expect(ref.current).toBe(field.element())
    expect(page.getByText('Reason').element().getBoundingClientRect().width).toBeLessThanOrEqual(1)
  })
})
