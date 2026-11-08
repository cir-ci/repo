import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { IconButton, RowMenuIcon } from '#src/index.ts'

describe('RowMenuIcon', () => {
  it('is a 16px icon hidden from assistive tech, so the button names it', async () => {
    await render(
      <IconButton label="Actions for Ada">
        <RowMenuIcon data-testid="icon" />
      </IconButton>,
    )
    const svg = page.getByTestId('icon').element()
    expect(svg).toHaveAttribute('width', '16')
    expect(svg).toHaveAttribute('stroke-width', '1.75')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    await expect.element(page.getByRole('button', { name: 'Actions for Ada' })).toBeVisible()
  })
})
