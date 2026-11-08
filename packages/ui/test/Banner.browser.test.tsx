import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { Banner, Button } from '#src/index.ts'

describe('Banner', () => {
  it('is a polite status for info, success and warning', async () => {
    await render(
      <>
        <Banner tone="info">Processing</Banner>
        <Banner tone="success">Approved</Banner>
        <Banner tone="warning">Needs review</Banner>
      </>,
    )
    await expect.element(page.getByRole('status').first()).toBeVisible()
    expect(page.getByRole('status').elements()).toHaveLength(3)
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  })

  it('is an alert only for danger', async () => {
    await render(<Banner tone="danger">Upload failed</Banner>)
    const alert = page.getByRole('alert')
    await expect.element(alert).toHaveTextContent('Upload failed')
    await expect.element(alert).toHaveAttribute('data-tone', 'danger')
    await expect.element(page.getByRole('status')).not.toBeInTheDocument()
  })

  it('shows its title and an action that can be used', async () => {
    await render(
      <Banner tone="warning" title="Heads up" action={<Button>Review</Button>}>
        Two screenshots changed.
      </Banner>,
    )
    await expect.element(page.getByRole('status').getByText('Heads up')).toBeVisible()
    expect(page.getByRole('status').element().textContent).toContain('Two screenshots changed.')
    await expect.element(page.getByRole('button', { name: 'Review' })).toBeVisible()
  })

  it('hides its icon from assistive tech', async () => {
    await render(<Banner tone="success">Done</Banner>)
    const svg = page.getByRole('status').element().querySelector('svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })
})
