import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { Ref } from '../src/index.ts'

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
}

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'clipboard', original)
  else Reflect.deleteProperty(navigator, 'clipboard')
})

describe('Ref', () => {
  it('shows the value in mono with a button named "Copy …"', async () => {
    await render(<Ref value="3f9c2ab" label="SHA" />)
    await expect.element(page.getByText('3f9c2ab')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Copy SHA' })).toBeVisible()
  })

  it('shows a shortened form but copies the full value', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
    stubClipboard(writeText)
    await render(<Ref value="3f9c2ab81d0e" display="3f9c2ab" label="SHA" />)
    await expect.element(page.getByText('3f9c2ab')).toBeVisible()
    await page.getByRole('button', { name: 'Copy SHA' }).click()
    expect(writeText).toHaveBeenCalledWith('3f9c2ab81d0e')
  })

  it('shows "Copied" for a moment in a status region, then clears it', async () => {
    stubClipboard(() => Promise.resolve())
    await render(<Ref value="main" label="branch" />)
    const status = page.getByRole('status')
    await expect.element(status).toHaveTextContent('')
    await page.getByRole('button', { name: 'Copy branch' }).click()
    await expect.element(status).toHaveTextContent('Copied')
    await expect.element(status, { timeout: 4000 }).toHaveTextContent('')
  })

  it('stays quiet when the clipboard refuses', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')))
    await render(<Ref value="main" label="branch" />)
    await page.getByRole('button', { name: 'Copy branch' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('')
  })

  it('names the button after the value when there is no label', async () => {
    await render(<Ref value="main" />)
    await expect.element(page.getByRole('button', { name: /^Copy/ })).toBeVisible()
  })
})
