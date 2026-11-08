import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { SkipLink } from '#src/index.ts'

describe('SkipLink', () => {
  it('is the first Tab stop, off-screen until focused, and points at the main content', async () => {
    await render(
      <>
        <SkipLink />
        <button>Other</button>
        <main id="main" tabIndex={-1}>
          Content
        </main>
      </>,
    )
    const link = page.getByRole('link', { name: 'Skip to content' })
    await expect.element(link).toHaveAttribute('href', '#main')
    expect(link.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(0)
    await userEvent.tab()
    await expect.element(link).toHaveFocus()
    expect(link.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
  })

  it('moves focus to the main content on Enter', async () => {
    await render(
      <>
        <SkipLink />
        <main id="main" tabIndex={-1}>
          Content
        </main>
      </>,
    )
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByRole('main')).toHaveFocus()
  })
})
