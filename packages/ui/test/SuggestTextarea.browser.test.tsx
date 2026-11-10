import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { SuggestTextarea } from '#src/index.ts'

const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, content: `Person ${i}` }))

/** Suggests while the text ends with `@`. */
function Harness({
  count = 2,
  onPick,
  onOuterKey,
}: {
  count?: number
  onPick?: (id: string) => void
  onOuterKey?: (key: string) => void
}) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div onKeyDown={(e) => onOuterKey?.(e.key)}>
      <SuggestTextarea
        aria-label="Comment"
        listLabel="Members"
        value={text}
        onChange={(next) => {
          setText(next)
          setOpen(next.endsWith('@'))
        }}
        suggestions={people(count)}
        open={open}
        onDismiss={() => setOpen(false)}
        onPick={(s) => {
          onPick?.(s.id)
          setOpen(false)
        }}
      />
    </div>
  )
}

describe('SuggestTextarea', () => {
  it('is a textbox until suggestions show, then a combobox that is expanded over its list', async () => {
    await render(<Harness />)
    const field = page.getByRole('textbox', { name: 'Comment' })
    await expect.element(field).toBeVisible()
    expect(page.getByRole('listbox').elements()).toHaveLength(0)
    await userEvent.type(field, 'hi @')
    const box = page.getByRole('combobox', { name: 'Comment' })
    await expect.element(box).toHaveAttribute('aria-expanded', 'true')
    await expect.element(page.getByRole('listbox', { name: 'Members' })).toBeVisible()
    expect(page.getByRole('option').elements()).toHaveLength(2)
    // The first option is active, and the textarea (not the list) keeps focus.
    await expect
      .element(page.getByRole('option', { name: 'Person 0' }))
      .toHaveAttribute('data-highlighted')
    await expect.element(box).toHaveFocus()
  })

  it('moves with the arrows and picks with Enter or Tab, but never with ⌘↵', async () => {
    const onPick = vi.fn<(id: string) => void>()
    await render(<Harness onPick={onPick} />)
    await userEvent.type(page.getByRole('textbox'), '@')
    await userEvent.keyboard('{ArrowDown}')
    await expect
      .element(page.getByRole('option', { name: 'Person 1' }))
      .toHaveAttribute('data-highlighted')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    expect(onPick).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    expect(onPick).toHaveBeenLastCalledWith('p1')

    await userEvent.keyboard('@')
    await expect.element(page.getByRole('option', { name: 'Person 0' })).toBeVisible()
    await userEvent.keyboard('{Tab}')
    expect(onPick).toHaveBeenLastCalledWith('p0')
  })

  it('Esc closes the list and goes no further', async () => {
    const outer = vi.fn<(key: string) => void>()
    await render(<Harness onOuterKey={outer} />)
    await userEvent.type(page.getByRole('textbox'), '@')
    await expect.element(page.getByRole('listbox')).toBeVisible()
    outer.mockClear()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
    expect(outer).not.toHaveBeenCalledWith('Escape')
  })

  it('scrolls the active option into view as the arrows move through a long list', async () => {
    await render(<Harness count={30} />)
    await userEvent.type(page.getByRole('textbox'), '@')
    const list = page.getByRole('listbox').element()
    await userEvent.keyboard('{ArrowUp}')
    const last = page.getByRole('option', { name: 'Person 29' })
    await expect.element(last).toHaveAttribute('data-highlighted')
    const inView = () => {
      const row = last.element().getBoundingClientRect()
      const box = list.getBoundingClientRect()
      return row.top >= box.top - 1 && row.bottom <= box.bottom + 1
    }
    await expect.poll(inView).toBe(true)
    expect(list.scrollTop).toBeGreaterThan(0)
  })

  it('is not clipped by a container that hides overflow, and stays inside the window', async () => {
    await page.viewport(600, 300)
    await render(
      <div style={{ height: 40, overflow: 'hidden', marginTop: 200 }}>
        <Harness count={6} />
      </div>,
    )
    await userEvent.type(page.getByRole('textbox'), '@')
    const popup = page.getByRole('listbox').element()
    // It lives in a portal on the page, not inside the clipping container.
    expect(popup.closest('[style*="overflow: hidden"]')).toBeNull()
    await expect.element(page.getByRole('option', { name: 'Person 0' })).toBeVisible()
    const box = popup.getBoundingClientRect()
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight)
  })

  it('with a label it is a Field: named by the label, described, and invalid with an announced error', async () => {
    await render(
      <SuggestTextarea
        label="Comment"
        description="Plain text."
        listLabel="Members"
        value=""
        onChange={() => {}}
        suggestions={[]}
        open={false}
        onDismiss={() => {}}
        onPick={() => {}}
      />,
    )
    const field = page.getByRole('textbox', { name: 'Comment' })
    await expect.element(field).toHaveAccessibleDescription('Plain text.')
    await expect.element(field).not.toHaveAttribute('aria-invalid')
  })

  it('shows an error in place of the description, announced, with aria-invalid', async () => {
    await render(
      <SuggestTextarea
        label="Comment"
        hideLabel
        description="Plain text."
        error="Couldn't send"
        listLabel="Members"
        value=""
        onChange={() => {}}
        suggestions={[]}
        open={false}
        onDismiss={() => {}}
        onPick={() => {}}
      />,
    )
    const field = page.getByRole('textbox', { name: 'Comment' })
    await expect.element(field).toBeInvalid()
    await expect.element(page.getByRole('alert')).toHaveTextContent("Couldn't send")
    await expect.element(field).toHaveAccessibleDescription("Couldn't send")
  })
})
