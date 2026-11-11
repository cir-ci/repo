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
    await expect.poll(() => onChange.mock.calls.map(([v]) => v)).toEqual(['diff'])
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

  it('has none chosen without a value, and keeps one in the Tab order that the arrows rove from', async () => {
    const onChange = vi.fn<(value: string) => void>()
    await render(
      <>
        <button type="button">before</button>
        <SegmentedControl label="Status" value={undefined} options={OPTIONS} onChange={onChange} />
        <button type="button">after</button>
      </>,
    )
    for (const o of OPTIONS) {
      // eslint-disable-next-line no-await-in-loop -- one after another
      await expect
        .element(page.getByRole('button', { name: o.label }))
        .toHaveAttribute('aria-pressed', 'false')
    }
    await userEvent.click(page.getByRole('button', { name: 'before' }))
    await userEvent.tab()
    await expect.element(page.getByRole('button', { name: 'Side by side' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(page.getByRole('button', { name: 'Overlay' })).toHaveFocus()
    // Only one stop in the group: Tab leaves it.
    await userEvent.tab()
    await expect.element(page.getByRole('button', { name: 'after' })).toHaveFocus()
    await userEvent.keyboard(' ')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('wraps its options onto further rows when asked, and keeps a count beside a name', async () => {
    await page.viewport(220, 400)
    await render(
      <SegmentedControl
        label="Which"
        wrap
        value="a"
        onChange={() => {}}
        options={[
          {
            value: 'a',
            label: (
              <>
                Requested from you <span>3</span>
              </>
            ),
          },
          { value: 'b', label: 'Reviewed' },
          { value: 'c', label: 'Created by you' },
        ]}
      />,
    )
    const group = page.getByRole('group', { name: 'Which' }).element()
    expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth)
    const tops = new Set(
      [...group.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().top)),
    )
    expect(tops.size).toBeGreaterThan(1)
    await expect.element(page.getByRole('button', { name: /^Requested from you 3/ })).toBeVisible()
  })
})
