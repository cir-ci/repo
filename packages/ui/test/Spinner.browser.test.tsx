import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { Spinner } from '../src/index.ts'

describe('Spinner', () => {
  it('is decorative without a label', async () => {
    const { container } = await render(<Spinner />)
    const spinner = container.firstElementChild
    if (!(spinner instanceof HTMLElement)) throw new Error('no spinner')
    expect(spinner.getAttribute('aria-hidden')).toBe('true')
    expect(getComputedStyle(spinner).width).toBe('16px')
  })

  it('is an image named by its label when given one', async () => {
    await render(<Spinner size={12} label="Loading builds" />)
    const spinner = page.getByRole('img', { name: 'Loading builds' })
    await expect.element(spinner).toBeInTheDocument()
    expect(getComputedStyle(spinner.element()).width).toBe('12px')
  })
})
