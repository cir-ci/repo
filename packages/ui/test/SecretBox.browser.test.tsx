import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { SecretBox } from '#src/index.ts'

import { stubClipboard } from './support/clipboard.ts'

describe('SecretBox', () => {
  it('shows the label and the value, with a copy button named after the label', async () => {
    await render(<SecretBox label="CI token" value="circi_abc123" />)
    await expect.element(page.getByText('CI token', { exact: true })).toBeVisible()
    await expect.element(page.getByText('circi_abc123')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Copy CI token' })).toBeVisible()
  })

  it('copies the value', async () => {
    const writeText = stubClipboard()
    await render(<SecretBox label="Signing secret" value="whsec_1" />)
    await page.getByRole('button', { name: 'Copy Signing secret' }).click()
    await expect.poll(() => writeText).toHaveBeenCalledWith('whsec_1')
  })
})
