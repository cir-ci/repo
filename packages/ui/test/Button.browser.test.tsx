import type { MouseEvent } from 'react'
import { expect, it, describe, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Button, Kbd } from '#src/index.ts'

describe('Button', () => {
  it('is a button named by its label and calls onClick', async () => {
    const onClick = vi.fn<() => void>()
    await render(<Button onClick={onClick}>Save</Button>)
    const button = page.getByRole('button', { name: 'Save' })
    await expect.element(button).toHaveAttribute('type', 'button')
    await button.click()
    await expect.poll(() => onClick).toHaveBeenCalledTimes(1)
  })

  it('carries its variant and size as data attributes and is 24px high when small', async () => {
    await render(
      <Button variant="danger" size="sm">
        Delete
      </Button>,
    )
    const button = page.getByRole('button', { name: 'Delete' })
    await expect.element(button).toHaveAttribute('data-variant', 'danger')
    await expect.element(button).toHaveAttribute('data-size', 'sm')
    // The compiled CSS module is really applied.
    expect(getComputedStyle(button.element()).height).toBe('24px')
  })

  it('is 28px high by default', async () => {
    await render(<Button>Save</Button>)
    await expect
      .poll(() => getComputedStyle(page.getByRole('button').element()).height)
      .toBe('28px')
  })

  it('does not call onClick when disabled', async () => {
    const onClick = vi.fn<() => void>()
    await render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    )
    const button = page.getByRole('button', { name: 'Save' })
    await expect.element(button).toBeDisabled()
    await button.click({ force: true })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('while loading keeps its label, is busy and ignores clicks, but stays focusable', async () => {
    const onClick = vi.fn<() => void>()
    await render(
      <Button loading onClick={onClick}>
        Create
      </Button>,
    )
    const button = page.getByRole('button', { name: 'Create' })
    await expect.element(button).toHaveAttribute('aria-busy', 'true')
    await button.click({ force: true })
    expect(onClick).not.toHaveBeenCalled()
    await userEvent.tab()
    await expect.element(button).toHaveFocus()
  })

  it('submits its form when type is submit', async () => {
    const onSubmit = vi.fn<(e: { preventDefault: () => void }) => void>((e) => e.preventDefault())
    await render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Go</Button>
      </form>,
    )
    await page.getByRole('button', { name: 'Go' }).click()
    await expect.poll(() => onSubmit).toHaveBeenCalledTimes(1)
  })

  it('renders the link variant as plain accent text: no box, underline on hover', async () => {
    await render(<Button variant="link">Read more</Button>)
    const button = page.getByRole('button', { name: 'Read more' })
    await expect.element(button).toHaveAttribute('data-variant', 'link')
    const style = getComputedStyle(button.element())
    expect(style.borderTopWidth).toBe('0px')
    expect(style.paddingLeft).toBe('0px')
    // The pointer may still sit where an earlier test left it, over this button: move it off first.
    await userEvent.unhover(button)
    await expect.poll(() => getComputedStyle(button.element()).textDecorationLine).toBe('none')
    await button.hover()
    await expect.poll(() => getComputedStyle(button.element()).textDecorationLine).toBe('underline')
  })

  it('is 36px high at size lg', async () => {
    await render(<Button size="lg">Sign in</Button>)
    const button = page.getByRole('button', { name: 'Sign in' })
    expect(getComputedStyle(button.element()).height).toBe('36px')
  })

  it('is a real link with href, and hands onClick the event for client-side routing', async () => {
    const onClick = vi.fn<(event: MouseEvent<HTMLElement>) => void>((e) => e.preventDefault())
    await render(
      <Button href="/sites" onClick={onClick}>
        Sites
      </Button>,
    )
    const link = page.getByRole('link', { name: 'Sites' })
    await expect.element(link).toHaveAttribute('href', '/sites')
    expect(page.getByRole('button').elements()).toHaveLength(0)
    expect(getComputedStyle(link.element()).height).toBe('28px')
    await link.click()
    await expect.poll(() => onClick).toHaveBeenCalledTimes(1)
  })
  it('toggle and filter are buttons with aria-pressed that flip on click and Space', async () => {
    const onPressedChange = vi.fn<(pressed: boolean) => void>()
    await render(
      <>
        <Button variant="toggle" onPressedChange={onPressedChange}>
          Wrap
        </Button>
        <Button variant="filter" defaultPressed>
          Status
        </Button>
      </>,
    )
    const wrap = page.getByRole('button', { name: 'Wrap' })
    await expect.element(wrap).toHaveAttribute('aria-pressed', 'false')
    await wrap.click()
    await expect.element(wrap).toHaveAttribute('aria-pressed', 'true')
    await userEvent.keyboard(' ')
    await expect.element(wrap).toHaveAttribute('aria-pressed', 'false')
    expect(onPressedChange.mock.calls.map(([pressed]) => pressed)).toEqual([true, false])
    const filter = page.getByRole('button', { name: 'Status' })
    await expect.element(filter).toHaveAttribute('aria-pressed', 'true')
    expect(getComputedStyle(filter.element()).height).toBe('24px')
  })

  it('a controlled pressed button follows its prop', async () => {
    await render(
      <Button variant="toggle" pressed>
        Wrap
      </Button>,
    )
    const wrap = page.getByRole('button', { name: 'Wrap' })
    await wrap.click()
    await expect.element(wrap).toHaveAttribute('aria-pressed', 'true')
  })

  it('other variants have no aria-pressed; select-trigger has no chrome', async () => {
    await render(
      <>
        <Button>Plain</Button>
        <Button variant="select-trigger">main</Button>
      </>,
    )
    await expect
      .element(page.getByRole('button', { name: 'Plain' }))
      .not.toHaveAttribute('aria-pressed')
    const trigger = page.getByRole('button', { name: 'main' }).element()
    expect(getComputedStyle(trigger).borderTopColor).toBe('rgba(0, 0, 0, 0)')
  })

  it("draws a shortcut hint on a primary button in the button's own text colour", async () => {
    await render(
      <Button variant="primary">
        Approve all <Kbd>⇧A</Kbd>
      </Button>,
    )
    const button = page.getByRole('button', { name: /Approve all/ }).element()
    const kbd = button.querySelector('kbd')!
    expect(getComputedStyle(kbd).color).toBe(getComputedStyle(button).color)
  })
})
