import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { TabList } from '#src/index.ts'

const TABS = [
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Done' },
  { value: 'later', label: 'Later' },
]

function Harness() {
  const [value, setValue] = useState('open')
  return (
    <TabList label="Items" tabs={TABS} value={value} onChange={setValue}>
      <p>Showing {value}</p>
    </TabList>
  )
}

describe('TabList', () => {
  it('is a named tablist whose chosen tab controls a panel named by it', async () => {
    await render(<Harness />)
    await expect.element(page.getByRole('tablist', { name: 'Items' })).toBeVisible()
    await expect
      .element(page.getByRole('tab', { name: 'Open' }))
      .toHaveAttribute('aria-selected', 'true')
    await expect
      .element(page.getByRole('tabpanel', { name: 'Open' }))
      .toHaveTextContent('Showing open')
  })

  it('chooses a tab on click', async () => {
    await render(<Harness />)
    await userEvent.click(page.getByRole('tab', { name: 'Done' }))
    await expect
      .element(page.getByRole('tabpanel', { name: 'Done' }))
      .toHaveTextContent('Showing done')
  })

  it('moves and chooses with the arrow keys, wrapping, and jumps with Home and End', async () => {
    await render(<Harness />)
    await userEvent.click(page.getByRole('tab', { name: 'Open' }))
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(page.getByRole('tab', { name: 'Later' })).toHaveFocus()
    await expect.element(page.getByRole('tabpanel', { name: 'Later' })).toBeVisible()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(page.getByRole('tab', { name: 'Open' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    await expect.element(page.getByRole('tab', { name: 'Later' })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    await expect.element(page.getByRole('tab', { name: 'Open' })).toHaveFocus()
  })
})
