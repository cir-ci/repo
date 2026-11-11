import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Link } from '#src/index.ts'

describe('Link', () => {
  it('is an anchor with its href, underlined only on hover', async () => {
    await render(<Link href="/builds">Builds</Link>)
    const link = page.getByRole('link', { name: 'Builds' })
    await expect.element(link).toHaveAttribute('href', '/builds')
    // The pointer may still rest where an earlier test hovered: move it away first.
    await userEvent.unhover(link)
    await expect.poll(() => getComputedStyle(link.element()).textDecorationLine).toBe('none')
    await link.hover()
    await expect.poll(() => getComputedStyle(link.element()).textDecorationLine).toBe('underline')
  })

  it('forwards its ref and any anchor props', async () => {
    const ref = createRef<HTMLAnchorElement>()
    await render(
      <Link ref={ref} href="https://example.com" target="_blank" rel="noreferrer" aria-label="Docs">
        d
      </Link>,
    )
    await expect
      .element(page.getByRole('link', { name: 'Docs' }))
      .toHaveAttribute('target', '_blank')
    expect(ref.current).toBe(page.getByRole('link', { name: 'Docs' }).element())
  })
})
