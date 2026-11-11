import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { NavItem } from '#src/index.ts'

/** Where the label of the link holding `name` starts, in px. */
const labelLeft = (name: string) =>
  [...document.querySelectorAll('a')]
    .find((a) => a.textContent?.includes(name))
    ?.querySelector('span:not([aria-hidden])')
    ?.getBoundingClientRect().left

describe('NavItem', () => {
  it('is a link with an href and marks the current page', async () => {
    await render(
      <NavItem href="/projects" selected>
        Projects
      </NavItem>,
    )
    const link = page.getByRole('link', { name: 'Projects' })
    await expect.element(link).toHaveAttribute('href', '/projects')
    await expect.element(link).toHaveAttribute('aria-current', 'page')
  })

  it('is a 32px button of 14px primary-colour text without an href, with icon and trailing content', async () => {
    const onClick = vi.fn<() => void>()
    await render(
      <NavItem
        onClick={onClick}
        icon={<svg data-testid="icon" width="16" height="16" strokeWidth="1.75" />}
        trailing={<span>3</span>}
      >
        Search
      </NavItem>,
    )
    const button = page.getByRole('button', { name: /Search/ })
    await button.click()
    expect(onClick).toHaveBeenCalledTimes(1)
    await expect.element(page.getByTestId('icon')).toBeInTheDocument()
    const style = getComputedStyle(button.element())
    expect([style.height, style.fontSize, style.fontWeight]).toEqual(['32px', '14px', '500'])
    expect(style.color).toBe(getComputedStyle(document.body).color)
    const icon = page.getByTestId('icon').element()
    expect(icon.getBoundingClientRect().width).toBe(18)
    expect(getComputedStyle(icon).strokeWidth).toBe('2px')
    expect(style.paddingLeft).toBe('10px')
    expect(button.element()).not.toHaveAttribute('aria-current')
  })

  it('announces the count in the name and shows it', async () => {
    await render(
      <NavItem href="/inbox" count={3} countLabel="unread">
        Inbox
      </NavItem>,
    )
    const link = page.getByRole('link', { name: /^Inbox ?, 3 unread$/ })
    await expect.element(link).toBeVisible()
  })

  it('draws a "more" row 28px tall in 13px secondary text, its label lined up with the labels above', async () => {
    await render(
      <>
        <NavItem href="/a" icon={<svg />}>
          Projects
        </NavItem>
        <NavItem href="/" more>
          All projects (12)
        </NavItem>
      </>,
    )
    const more = page.getByRole('link', { name: 'All projects (12)' }).element()
    const style = getComputedStyle(more)
    expect([style.height, style.fontSize, style.paddingLeft]).toEqual(['28px', '13px', '38px'])
    expect(labelLeft('All projects')).toBe(labelLeft('Projects'))
  })

  it('is 28px tall, 13px text, a 16px icon and indented as a sub item', async () => {
    await render(
      <NavItem href="/a" sub icon={<svg data-testid="sub-icon" width="16" height="16" />}>
        Child
      </NavItem>,
    )
    const style = getComputedStyle(page.getByRole('link', { name: 'Child' }).element())
    expect([style.height, style.paddingLeft, style.fontSize]).toEqual(['28px', '30px', '13px'])
    expect(page.getByTestId('sub-icon').element().getBoundingClientRect().width).toBe(16)
    expect(getComputedStyle(page.getByTestId('sub-icon').element()).strokeWidth).toBe('2px')
  })
})
