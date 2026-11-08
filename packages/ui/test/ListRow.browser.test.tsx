import type { MouseEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { ListRow } from '../src/index.ts'

describe('ListRow', () => {
  it('is a link with an href and a button with only onClick', async () => {
    const onClick = vi.fn<(event: MouseEvent<HTMLElement>) => void>()
    await render(
      <>
        <ListRow href="/a">Link row</ListRow>
        <ListRow onClick={onClick}>Button row</ListRow>
      </>,
    )
    await expect.element(page.getByRole('link', { name: 'Link row' })).toHaveAttribute('href', '/a')
    await page.getByRole('button', { name: 'Button row' }).click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('hands onClick the click event, so a link row can navigate client-side', async () => {
    const onClick = vi.fn<(event: MouseEvent<HTMLElement>) => void>((event) => {
      event.preventDefault()
    })
    await render(
      <ListRow href="/a" onClick={onClick}>
        Link row
      </ListRow>,
    )
    await page.getByRole('link', { name: 'Link row' }).click()
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick.mock.calls[0]?.[0].defaultPrevented).toBe(true)
    expect(onClick.mock.calls[0]?.[0].type).toBe('click')
  })

  it('is a plain, non-interactive row otherwise, at least 44px high', async () => {
    await render(<ListRow>Static</ListRow>)
    expect(page.getByRole('link').elements()).toHaveLength(0)
    expect(page.getByRole('button').elements()).toHaveLength(0)
    const row = page.getByText('Static').element().parentElement
    expect(row?.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  })

  it('shows leading and trailing content and marks the selected row', async () => {
    await render(
      <ListRow href="/a" selected leading={<span>L</span>} trailing={<span>T</span>}>
        Row
      </ListRow>,
    )
    const row = page.getByRole('link')
    await expect.element(row).toHaveAttribute('aria-current', 'true')
    await expect.element(row).toHaveTextContent('LRowT')
  })
})
