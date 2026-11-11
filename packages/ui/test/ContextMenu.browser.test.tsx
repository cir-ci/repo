import { Trash2 } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { ContextMenu } from '#src/index.ts'

function Harness(props: { onOpen?: () => void; onDelete?: () => void }) {
  return (
    <ContextMenu
      trigger={<div tabIndex={0}>Build row</div>}
      items={[
        { label: 'Open', onSelect: props.onOpen, shortcut: 'O' },
        { label: 'Copy link' },
        { type: 'separator' },
        { label: 'Delete', tone: 'danger', icon: <Trash2 />, onSelect: props.onDelete },
      ]}
    />
  )
}

describe('ContextMenu', () => {
  it('opens a menu of menuitems on a right click and leaves the row as the one element', async () => {
    await page.viewport(1000, 600)
    await render(<Harness />)
    await page.getByText('Build row').click({ button: 'right' })
    await expect.element(page.getByRole('menu')).toBeVisible()
    expect(page.getByRole('menuitem').elements()).toHaveLength(3)
    await expect.element(page.getByRole('separator')).toBeInTheDocument()
    await expect.element(page.getByText('O', { exact: true })).toBeVisible()
    expect(page.getByText('Build row').element().children).toHaveLength(0)
  })

  it('opens from the keyboard context event on a focused row', async () => {
    await render(<Harness />)
    const row = page.getByText('Build row').element()
    if (!(row instanceof HTMLElement)) throw new Error('row is not an element')
    row.focus()
    // The context menu key and Shift+F10 make the browser fire this event on the focused element.
    const rect = row.getBoundingClientRect()
    row.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 4,
        clientY: rect.bottom,
      }),
    )
    await expect.element(page.getByRole('menu')).toBeVisible()
  })

  it('moves with the arrow keys, runs the item on Enter and closes', async () => {
    const onDelete = vi.fn<() => void>()
    await render(<Harness onDelete={onDelete} />)
    await page.getByText('Build row').click({ button: 'right' })
    await expect.element(page.getByRole('menu')).toBeVisible()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('menuitem', { name: 'Open' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('menuitem', { name: 'Copy link' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onDelete).toHaveBeenCalledTimes(1)
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  })

  it('runs an item on click', async () => {
    const onOpen = vi.fn<() => void>()
    await render(<Harness onOpen={onOpen} />)
    await page.getByText('Build row').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /Open/ }).click()
    expect(onOpen).toHaveBeenCalledTimes(1)
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    await render(<Harness />)
    await page.getByText('Build row').click({ button: 'right' })
    await expect.element(page.getByRole('menu')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  })

  it('marks a danger item and sizes items like Menu', async () => {
    await render(<Harness />)
    await page.getByText('Build row').click({ button: 'right' })
    const danger = page.getByRole('menuitem', { name: 'Delete' })
    await expect.element(danger).toHaveAttribute('data-tone', 'danger')
    expect(getComputedStyle(danger.element()).height).toBe('28px')
    await expect
      .element(page.getByRole('menuitem', { name: 'Open' }))
      .not.toHaveAttribute('data-tone')
  })

  it('shows no menu when disabled', async () => {
    await render(
      <ContextMenu disabled trigger={<div>Build row</div>} items={[{ label: 'Open' }]} />,
    )
    await page.getByText('Build row').click({ button: 'right' })
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  })

  it('wraps children it cannot give props to, without a box of its own', async () => {
    await render(
      <ContextMenu items={[{ label: 'Open' }]}>
        <a href="/x">Project link</a>
      </ContextMenu>,
    )
    await page.getByText('Project link').click({ button: 'right' })
    await expect.element(page.getByRole('menuitem', { name: 'Open' })).toBeVisible()
  })

  it('leaves the row alone with no items', async () => {
    await render(<ContextMenu items={[]} trigger={<div>Build row</div>} />)
    await page.getByText('Build row').click({ button: 'right' })
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  })
})
