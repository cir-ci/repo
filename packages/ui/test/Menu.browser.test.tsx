import { MoreHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { IconButton, Menu, SegmentedControl } from '#src/index.ts'

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
    await page.viewport(1000, 600)
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
    await page.viewport(1000, 600)
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

  it('has 36px items, 14px text and 18px icons at stroke 2 with size="md"', async () => {
    await page.viewport(1000, 600)
    await render(
      <Menu
        size="md"
        trigger={<IconButton label="Row actions">x</IconButton>}
        items={[
          {
            label: 'Account',
            icon: <svg data-testid="glyph" width="16" height="16" strokeWidth="1.75" />,
          },
        ]}
      />,
    )
    await page.getByRole('button', { name: 'Row actions' }).click()
    await expect.element(page.getByRole('menu')).toBeVisible()
    const item = getComputedStyle(page.getByRole('menuitem').first().element())
    expect([item.height, item.fontSize]).toEqual(['36px', '14px'])
    const glyph = page.getByTestId('glyph').element()
    expect([getComputedStyle(glyph).width, getComputedStyle(glyph).height]).toEqual([
      '18px',
      '18px',
    ])
    expect(getComputedStyle(glyph).strokeWidth).toBe('2px')
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
    await expect.poll(() => onRemove).toHaveBeenCalledTimes(1)
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })

  it('runs an item on click', async () => {
    const onAccount = vi.fn<() => void>()
    await render(<Harness onAccount={onAccount} />)
    await page.getByRole('button', { name: 'Row actions' }).click()
    await page.getByRole('menuitem', { name: /Account/ }).click()
    await expect.poll(() => onAccount).toHaveBeenCalledTimes(1)
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
    await page.viewport(1000, 600)
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
    await expect.poll(() => page.getByRole('menuitem').elements()).toHaveLength(1)
    await page.getByRole('button', { name: 'Dark' }).click()
    await expect.poll(() => picked).toEqual(['dark'])
    await expect.element(page.getByRole('menu')).toBeVisible()
    // Arrow keys move inside the control, not between the menu's items.
    page.getByRole('button', { name: 'Light' }).element().focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(page.getByRole('button', { name: 'Dark' })).toHaveFocus()
  })
})

function Theme(props: { onChange: (value: string) => void }) {
  const [value, setValue] = useState('system')
  return (
    <Menu
      trigger={<IconButton label="Account menu">…</IconButton>}
      items={[
        { label: 'Account' },
        {
          type: 'radio-group',
          name: 'Theme',
          value,
          onValueChange: (next) => {
            setValue(next)
            props.onChange(next)
          },
          options: [
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ],
        },
      ]}
    />
  )
}

describe('Menu radio group', () => {
  it('is a radiogroup of menuitemradio items with the chosen one checked', async () => {
    await render(<Theme onChange={() => undefined} />)
    await page.getByRole('button', { name: 'Account menu' }).click()
    await expect.element(page.getByRole('group', { name: 'Theme' })).toBeInTheDocument()
    expect(page.getByRole('menuitemradio').elements()).toHaveLength(3)
    await expect
      .element(page.getByRole('menuitemradio', { name: 'System' }))
      .toHaveAttribute('aria-checked', 'true')
  })

  it('moves with the arrow keys, picks with Enter, stays open and reports the change', async () => {
    const onChange = vi.fn<(value: string) => void>()
    await render(<Theme onChange={onChange} />)
    const trigger = page.getByRole('button', { name: 'Account menu' })
    await trigger.click()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    await expect.element(page.getByRole('menuitemradio', { name: 'Light' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => onChange).toHaveBeenCalledWith('light')
    await expect
      .element(page.getByRole('menuitemradio', { name: 'Light' }))
      .toHaveAttribute('aria-checked', 'true')
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })

  it('shows a focus ring on the item the keyboard reached', async () => {
    await render(<Theme onChange={() => undefined} />)
    await page.getByRole('button', { name: 'Account menu' }).click()
    await userEvent.keyboard('{ArrowDown}')
    const style = getComputedStyle(page.getByRole('menuitem', { name: 'Account' }).element())
    expect(style.outlineStyle).toBe('solid')
    expect(style.outlineWidth).toBe('2px')
  })
})
