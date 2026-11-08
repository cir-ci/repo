import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { SegmentedControl } from '#src/index.ts'

const OPTIONS = [
  { value: 'side', label: 'Side by side' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'diff', label: 'Diff' },
]

function Harness(props: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('side')
  return (
    <SegmentedControl
      label="Compare mode"
      value={value}
      options={OPTIONS}
      onChange={(v) => {
        props.onChange?.(v)
        setValue(v)
      }}
    />
  )
}

describe('SegmentedControl', () => {
  it('is a named group whose current option is pressed', async () => {
    await render(<Harness />)
    await expect.element(page.getByRole('group', { name: 'Compare mode' })).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Side by side' }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect
      .element(page.getByRole('button', { name: 'Diff' }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it('reports a change and moves the pressed state', async () => {
    const onChange = vi.fn<(value: string) => void>()
    await render(<Harness onChange={onChange} />)
    await page.getByRole('button', { name: 'Diff' }).click()
    expect(onChange).toHaveBeenCalledWith('diff')
    await expect
      .element(page.getByRole('button', { name: 'Diff' }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect
      .element(page.getByRole('button', { name: 'Side by side' }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps one option chosen: pressing the chosen one again changes nothing', async () => {
    const onChange = vi.fn<(value: string) => void>()
    await render(<Harness onChange={onChange} />)
    await page.getByRole('button', { name: 'Side by side' }).click()
    expect(onChange).not.toHaveBeenCalled()
    await expect
      .element(page.getByRole('button', { name: 'Side by side' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('moves focus between options with the arrow keys', async () => {
    await render(<Harness />)
    await userEvent.tab()
    await expect.element(page.getByRole('button', { name: 'Side by side' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(page.getByRole('button', { name: 'Overlay' })).toHaveFocus()
  })
})
