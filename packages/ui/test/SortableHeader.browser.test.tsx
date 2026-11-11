import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { SortableHeader } from '#src/index.ts'

type Sort = 'none' | 'ascending' | 'descending'
const NEXT: Record<Sort, Sort> = { none: 'ascending', ascending: 'descending', descending: 'none' }

function Table() {
  const [sort, setSort] = useState<Sort>('none')
  return (
    <table>
      <thead>
        <tr>
          <SortableHeader scope="col" sort={sort} onSort={() => setSort(NEXT[sort])}>
            Name
          </SortableHeader>
          <SortableHeader scope="col" numeric onSort={() => {}}>
            Count
          </SortableHeader>
        </tr>
      </thead>
    </table>
  )
}

describe('SortableHeader', () => {
  it('is a button inside the column header, with aria-sort on the header', async () => {
    await render(<Table />)
    const header = page.getByRole('columnheader', { name: 'Name' })
    await expect.element(header).toHaveAttribute('aria-sort', 'none')
    const button = header.getByRole('button', { name: 'Name' })
    await expect.element(button).toBeVisible()
    expect(button.element().closest('th')).toBe(header.element())
    await expect
      .element(page.getByRole('columnheader', { name: 'Count' }))
      .toHaveAttribute('aria-sort', 'none')
  })

  it('cycles ascending, descending, then back, on click', async () => {
    await render(<Table />)
    const header = page.getByRole('columnheader', { name: 'Name' })
    const button = header.getByRole('button')
    await button.click()
    await expect.element(header).toHaveAttribute('aria-sort', 'ascending')
    expect(header.element().querySelector('svg')).not.toBeNull()
    await button.click()
    await expect.element(header).toHaveAttribute('aria-sort', 'descending')
    expect(header.element().querySelector('svg')).not.toBeNull()
    await button.click()
    await expect.element(header).toHaveAttribute('aria-sort', 'none')
    expect(header.element().querySelector('svg')).toBeNull()
  })

  it('works from the keyboard: Tab to it, Enter or Space to sort', async () => {
    const onSort = vi.fn<() => void>()
    await render(
      <table>
        <thead>
          <tr>
            <SortableHeader scope="col" onSort={onSort}>
              Name
            </SortableHeader>
          </tr>
        </thead>
      </table>,
    )
    await userEvent.tab()
    await expect.element(page.getByRole('button', { name: 'Name' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => onSort).toHaveBeenCalledTimes(1)
    await userEvent.keyboard(' ')
    await expect.poll(() => onSort).toHaveBeenCalledTimes(2)
  })

  it('right-aligns the label of a column of numbers', async () => {
    await render(<Table />)
    const count = page.getByRole('columnheader', { name: 'Count' }).element()
    expect(getComputedStyle(count).textAlign).toBe('right')
  })

  it('as="div" is a column header of a grid-built table', async () => {
    const onSort = vi.fn<() => void>()
    await render(
      <div role="table" aria-label="Deliveries">
        <div role="row">
          <SortableHeader as="div" sort="descending" onSort={onSort}>
            Time
          </SortableHeader>
        </div>
      </div>,
    )
    const header = page.getByRole('columnheader', { name: 'Time' })
    await expect.element(header).toHaveAttribute('aria-sort', 'descending')
    await header.getByRole('button').click()
    await expect.poll(() => onSort).toHaveBeenCalledTimes(1)
  })
})
