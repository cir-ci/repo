import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { useCopy } from '#lib/use-copy.ts'
import { stubClipboard } from '#test/support/clipboard.ts'

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

describe('useCopy', () => {
  it('goes idle, copied, then idle again on reset', async () => {
    const writeText = stubClipboard()
    await render(<Probe />)
    await expect.element(page.getByRole('status')).toHaveTextContent('idle')
    await page.getByRole('button', { name: 'Copy' }).click()
    await expect.poll(() => writeText.mock.calls.map(([t]) => t)).toEqual(['hello'])
    await expect.element(page.getByRole('status')).toHaveTextContent('copied')
    await page.getByRole('button', { name: 'Reset' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('idle')
  })

  it('is failed when the browser refuses the clipboard', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')))
    await render(<Probe />)
    await page.getByRole('button', { name: 'Copy' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('failed')
  })
})
