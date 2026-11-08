import { ListRow } from '@circi/ui'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { useListNavigation } from '../../src/lib/use-list-navigation.ts'

const ITEMS = ['alpha', 'beta', 'gamma']

function List() {
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const { ref, rowProps } = useListNavigation({
    items: ITEMS,
    getId: (item) => item,
    selectedId: selected,
    onSelect: setSelected,
  })
  return (
    <>
      <ul ref={(el) => void (ref.current = el)}>
        {ITEMS.map((item) => (
          <li key={item} {...rowProps(item)}>
            <ListRow href={`#${item}`} selected={item === selected}>
              {item}
            </ListRow>
          </li>
        ))}
      </ul>
      <input aria-label="Filter" />
    </>
  )
}

describe('useListNavigation', () => {
  it('moves the selection and the focus together with j and k', async () => {
    await render(<List />)
    await userEvent.keyboard('j')
    await expect.element(page.getByRole('link', { name: 'alpha' })).toHaveFocus()
    await expect.element(page.getByRole('link', { name: 'alpha' })).toHaveAttribute('aria-current')
    await userEvent.keyboard('j')
    await expect.element(page.getByRole('link', { name: 'beta' })).toHaveFocus()
    await expect.element(page.getByRole('link', { name: 'beta' })).toHaveAttribute('aria-current')
    await expect
      .element(page.getByRole('link', { name: 'alpha' }))
      .not.toHaveAttribute('aria-current')
    await userEvent.keyboard('k')
    await expect.element(page.getByRole('link', { name: 'alpha' })).toHaveFocus()
  })

  it('stops at the last row', async () => {
    await render(<List />)
    await userEvent.keyboard('jjjj')
    await expect.element(page.getByRole('link', { name: 'gamma' })).toHaveFocus()
  })

  it('leaves j and k to a field being typed in', async () => {
    await render(<List />)
    await userEvent.click(page.getByRole('textbox', { name: 'Filter' }))
    await userEvent.keyboard('jk')
    await expect.element(page.getByRole('textbox', { name: 'Filter' })).toHaveValue('jk')
    await expect.element(page.getByRole('textbox', { name: 'Filter' })).toHaveFocus()
  })
})
