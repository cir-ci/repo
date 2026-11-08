import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import {
  ArrowBackIcon,
  GlobeIcon,
  MenuIcon,
  RowMenuIcon,
  RefreshIcon,
  UsersIcon,
} from '../src/index.ts'

describe('icons', () => {
  it('are 16px, stroke 1.75 and hidden from assistive tech by default', async () => {
    await render(<ArrowBackIcon data-testid="i" />)
    const svg = page.getByTestId('i').element()
    expect(svg).toHaveAttribute('width', '16')
    expect(svg).toHaveAttribute('stroke-width', '1.75')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('can be sized and named', async () => {
    await render(<RefreshIcon size={14} aria-label="Refresh" role="img" />)
    const svg = page.getByRole('img', { name: 'Refresh' }).element()
    expect(svg).toHaveAttribute('width', '14')
  })

  it('include the globe and the row menu "…" with the same defaults', async () => {
    await render(
      <>
        <GlobeIcon data-testid="g" />
        <RowMenuIcon data-testid="r" />
      </>,
    )
    for (const id of ['g', 'r']) {
      const svg = page.getByTestId(id).element()
      expect(svg).toHaveAttribute('width', '16')
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('include the shell icons', async () => {
    await render(
      <>
        <MenuIcon data-testid="m" />
        <UsersIcon data-testid="u" />
      </>,
    )
    expect(page.getByTestId('m').element()).toHaveAttribute('width', '16')
    expect(page.getByTestId('u').element()).toHaveAttribute('width', '16')
  })
})
