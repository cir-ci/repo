import { MoreHorizontal, Trash2 } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { IconButton, Menu, SegmentedControl } from '../src/index.ts'

function Harness(props: { onRemove?: () => void; onAccount?: () => void }) {
  return (
    <Menu
      trigger={
        <IconButton label="Row actions">
          <MoreHorizontal />
        </IconButton>
      }
      items={[
        { label: 'Account', onSelect: props.onAccount, shortcut: 'G A' },
        { label: 'Theme' },
        { type: 'separator' },
        { label: 'Remove', tone: 'danger', icon: <Trash2 />, onSelect: props.onRemove },
        { label: 'Locked', disabled: true },
      ]}
    />
  )
}

describe('Menu', () => {
  it('opens a menu of menuitems from its trigger', async () => {
    await page.viewport(800, 600)
    await render(<Harness />)
    const trigger = page.getByRole('button', { name: 'Row actions' })
    await expect.element(trigger).toHaveAttribute('aria-haspopup', 'menu')
    await trigger.click()
    await expect.element(page.getByRole('menu')).toBeVisible()
    expect(page.getByRole('menuitem').elements()).toHaveLength(4)
    await expect.element(page.getByRole('separator')).toBeInTheDocument()
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens below its trigger and the items are 28px high', async () => {
    await page.viewport(800, 600)
    await render(<Harness />)
    const trigger = page.getByRole('button', { name: 'Row actions' })
    await trigger.click()
    const menu = page.getByRole('menu')
    await expect.element(menu).toBeVisible()
    expect(menu.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
      trigger.element().getBoundingClientRect().bottom,
    )
    expect(getComputedStyle(page.getByRole('menuitem').first().element()).height).toBe('28px')
  })

  it('moves with the arrow keys, runs the item on Enter and closes', async () => {
    const onRemove = vi.fn<() => void>()
    await render(<Harness onRemove={onRemove} />)
    const trigger = page.getByRole('button', { name: 'Row actions' })
    await trigger.click()
    await expect.element(page.getByRole('menu')).toBeVisible()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('menuitem', { name: 'Account' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('menuitem', { name: 'Theme' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('menuitem', { name: 'Remove' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onRemove).toHaveBeenCalledTimes(1)
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })

  it('runs an item on click', async () => {
    const onAccount = vi.fn<() => void>()
    await render(<Harness onAccount={onAccount} />)
    await page.getByRole('button', { name: 'Row actions' }).click()
    await page.getByRole('menuitem', { name: /Account/ }).click()
    expect(onAccount).toHaveBeenCalledTimes(1)
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    await render(<Harness />)
    const trigger = page.getByRole('button', { name: 'Row actions' })
    await trigger.click()
    await expect.element(page.getByRole('menu')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })

  it('shows shortcut text and does not run disabled items', async () => {
    await render(<Harness />)
    await page.getByRole('button', { name: 'Row actions' }).click()
    await expect.element(page.getByText('G A')).toBeVisible()
    await expect
      .element(page.getByRole('menuitem', { name: 'Locked' }))
      .toHaveAttribute('aria-disabled', 'true')
  })

  it('holds a control that is not an item and keeps its arrow keys', async () => {
    await page.viewport(800, 600)
    const picked: string[] = []
    await render(
      <Menu
        trigger={<IconButton label="Account menu">…</IconButton>}
        items={[
          { label: 'Account' },
          {
            type: 'content',
            name: 'theme',
            node: (
              <SegmentedControl
                label="Theme"
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
                value="light"
                onChange={(v) => picked.push(v)}
              />
            ),
          },
        ]}
      />,
    )
    await page.getByRole('button', { name: 'Account menu' }).click()
    expect(page.getByRole('menuitem').elements()).toHaveLength(1)
    await page.getByRole('button', { name: 'Dark' }).click()
    expect(picked).toEqual(['dark'])
    await expect.element(page.getByRole('menu')).toBeVisible()
    // Arrow keys move inside the control, not between the menu's items.
    page.getByRole('button', { name: 'Light' }).element().focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(page.getByRole('button', { name: 'Dark' })).toHaveFocus()
  })
})
