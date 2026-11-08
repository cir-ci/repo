import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { AnnouncerProvider, useAnnounce } from '#src/index.ts'

function Trigger(props: { message: string }) {
  const announce = useAnnounce()
  return <button onClick={() => announce(props.message)}>Go</button>
}

describe('AnnouncerProvider', () => {
  it('has one polite status region in the DOM from the start', async () => {
    await render(
      <AnnouncerProvider>
        <Trigger message="Saved" />
      </AnnouncerProvider>,
    )
    const region = page.getByRole('status')
    await expect.element(region).toHaveAttribute('aria-live', 'polite')
    await expect.element(region).toHaveTextContent('')
  })

  it('puts the announced message in the region', async () => {
    await render(
      <AnnouncerProvider>
        <Trigger message="Build approved" />
      </AnnouncerProvider>,
    )
    await page.getByRole('button', { name: 'Go' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Build approved')
  })

  it('announces the same message again after it was cleared', async () => {
    await render(
      <AnnouncerProvider>
        <Trigger message="Saved" />
      </AnnouncerProvider>,
    )
    const go = page.getByRole('button', { name: 'Go' })
    await go.click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Saved')
    await go.click()
    // Cleared at once, then set again.
    await expect.element(page.getByRole('status')).toHaveTextContent('Saved')
  })

  it('does nothing outside a provider', async () => {
    await render(<Trigger message="Saved" />)
    await page.getByRole('button', { name: 'Go' }).click()
    await expect.element(page.getByRole('status')).not.toBeInTheDocument()
  })
})
