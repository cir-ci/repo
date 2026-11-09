import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { useCopy } from '#lib/use-copy.ts'

function Probe() {
  const { copy, state, reset } = useCopy()
  return (
    <>
      <button type="button" onClick={() => void copy('hello')}>
        Copy
      </button>
      <button type="button" onClick={reset}>
        Reset
      </button>
      <output>{state}</output>
    </>
  )
}

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  if (original) Object.defineProperty(navigator, 'clipboard', original)
})

function stub(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
}

describe('useCopy', () => {
  it('goes idle, copied, then idle again on reset', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
    stub(writeText)
    await render(<Probe />)
    await expect.element(page.getByRole('status')).toHaveTextContent('idle')
    await page.getByRole('button', { name: 'Copy' }).click()
    expect(writeText).toHaveBeenCalledWith('hello')
    await expect.element(page.getByRole('status')).toHaveTextContent('copied')
    await page.getByRole('button', { name: 'Reset' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('idle')
  })

  it('is failed when the browser refuses the clipboard', async () => {
    stub(() => Promise.reject(new Error('denied')))
    await render(<Probe />)
    await page.getByRole('button', { name: 'Copy' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('failed')
  })
})
