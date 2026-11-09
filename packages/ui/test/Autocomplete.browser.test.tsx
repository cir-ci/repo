import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Autocomplete } from '#src/index.ts'

const BRANCHES = ['main', 'feature/login', 'qa/pr20']

/** Narrows by what is typed, as a caller does (here in memory, in the app by the server). */
function Harness({
  onPick,
  onSubmit,
}: {
  onPick?: (v: string) => void
  onSubmit?: (v: string) => void
}) {
  const [text, setText] = useState('')
  const shown = BRANCHES.filter((b) => b.toLowerCase().includes(text.toLowerCase()))
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.(text)
      }}
    >
      <Autocomplete
        label="Branch"
        value={text}
        onValueChange={setText}
        items={shown}
        {...(onPick ? { onPick } : {})}
        emptyText="No branches match"
        listLabel="Branches"
      />
    </form>
  )
}

describe('Autocomplete', () => {
  it('is a text field named by its label, 32px high, with the suggestions listed', async () => {
    await render(<Harness />)
    const input = page.getByRole('combobox', { name: 'Branch' })
    await expect.element(input).toBeVisible()
    expect(getComputedStyle(input.element()).height).toBe('32px')
    await expect.element(page.getByRole('option', { name: 'qa/pr20' })).toBeVisible()
    expect(page.getByRole('option').elements()).toHaveLength(3)
  })

  it('narrows the suggestions as you type, ignoring case', async () => {
    await render(<Harness />)
    await page.getByRole('combobox', { name: 'Branch' }).fill('QA')
    await expect.element(page.getByRole('option', { name: 'qa/pr20' })).toBeVisible()
    expect(page.getByRole('option').elements()).toHaveLength(1)
    await page.getByRole('combobox', { name: 'Branch' }).fill('zzz')
    await expect.element(page.getByText('No branches match')).toBeVisible()
  })

  it('picks a suggestion with the arrow keys and Enter, without submitting the form', async () => {
    const onPick = vi.fn<(value: string) => void>()
    const onSubmit = vi.fn<(value: string) => void>()
    await render(<Harness onPick={onPick} onSubmit={onSubmit} />)
    await page.getByRole('combobox', { name: 'Branch' }).click()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onPick).toHaveBeenCalledExactlyOnceWith('feature/login')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('picks with a click', async () => {
    const onPick = vi.fn<(value: string) => void>()
    await render(<Harness onPick={onPick} />)
    await page.getByRole('option', { name: 'main' }).click()
    expect(onPick).toHaveBeenCalledExactlyOnceWith('main')
  })

  it('submits the typed text with Enter when no suggestion is highlighted', async () => {
    const onPick = vi.fn<(value: string) => void>()
    const onSubmit = vi.fn<(value: string) => void>()
    await render(<Harness onPick={onPick} onSubmit={onSubmit} />)
    await page.getByRole('combobox', { name: 'Branch' }).fill('qa')
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('qa')
    expect(onPick).not.toHaveBeenCalled()
  })
})
