import type { MouseEvent } from 'react'
import { expect, it, describe, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Button } from '../src/index.ts'

describe('Button', () => {
  it('is a button named by its label and calls onClick', async () => {
    const onClick = vi.fn<() => void>()
    await render(<Button onClick={onClick}>Save</Button>)
    const button = page.getByRole('button', { name: 'Save' })
    await expect.element(button).toHaveAttribute('type', 'button')
    await button.click()
    expect(onClick).toHaveBeenCalledTimes(1)
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
    expect(getComputedStyle(page.getByRole('button').element()).height).toBe('28px')
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
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('renders the link variant as plain accent text: no box, underline on hover', async () => {
    await render(<Button variant="link">Read more</Button>)
    const button = page.getByRole('button', { name: 'Read more' })
    await expect.element(button).toHaveAttribute('data-variant', 'link')
    const style = getComputedStyle(button.element())
    expect(style.borderTopWidth).toBe('0px')
    expect(style.paddingLeft).toBe('0px')
    expect(style.textDecorationLine).toBe('none')
    await button.hover()
    await expect.poll(() => getComputedStyle(button.element()).textDecorationLine).toBe('underline')
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
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
