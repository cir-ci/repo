import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { NavItem } from '#src/index.ts'

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

  it('is a 28px button without an href, with icon and trailing content', async () => {
    const onClick = vi.fn<() => void>()
    await render(
      <NavItem onClick={onClick} icon={<svg data-testid="icon" />} trailing={<span>3</span>}>
        Search
      </NavItem>,
    )
    const button = page.getByRole('button', { name: /Search/ })
    await button.click()
    expect(onClick).toHaveBeenCalledTimes(1)
    await expect.element(page.getByTestId('icon')).toBeInTheDocument()
    expect(getComputedStyle(button.element()).height).toBe('28px')
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

  it('is 26px tall and indented as a sub item', async () => {
    await render(
      <NavItem href="/a" sub>
        Child
      </NavItem>,
    )
    const style = getComputedStyle(page.getByRole('link', { name: 'Child' }).element())
    expect([style.height, style.paddingLeft]).toEqual(['26px', '26px'])
  })
})
