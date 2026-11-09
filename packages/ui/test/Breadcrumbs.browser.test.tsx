import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Breadcrumbs } from '#src/index.ts'

const ITEMS = [
  { label: 'Projects', href: '/projects' },
  { label: 'web-app', href: '/projects/web-app' },
  { label: 'Build #148' },
]

describe('Breadcrumbs', () => {
  it('is a navigation landmark with the last item as the current page', async () => {
    await render(<Breadcrumbs items={ITEMS} />)
    await expect.element(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
    expect(page.getByRole('listitem').elements()).toHaveLength(3)
    const current = page.getByText('Build #148')
    await expect.element(current).toHaveAttribute('aria-current', 'page')
    await expect.element(page.getByRole('link', { name: 'Build #148' })).not.toBeInTheDocument()
  })

  it('links the earlier items', async () => {
    await render(<Breadcrumbs items={ITEMS} />)
    await expect
      .element(page.getByRole('link', { name: 'Projects' }))
      .toHaveAttribute('href', '/projects')
    await expect
      .element(page.getByRole('link', { name: 'web-app' }))
      .toHaveAttribute('href', '/projects/web-app')
  })

  it('takes a custom landmark name and calls onClick for client-side routing', async () => {
    const onClick = vi.fn<(e: { preventDefault: () => void }) => void>((e) => e.preventDefault())
    await render(
      <Breadcrumbs
        label="Path"
        items={[{ label: 'Projects', href: '/projects', onClick }, { label: 'web-app' }]}
      />,
    )
    await expect.element(page.getByRole('navigation', { name: 'Path' })).toBeVisible()
    await page.getByRole('link', { name: 'Projects' }).click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps crumbs with the same label apart', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await render(
      <Breadcrumbs
        items={[
          { label: 'Docs', href: '/a' },
          { label: 'Docs', href: '/a/docs' },
          { label: 'Docs', key: 'last' },
        ]}
      />,
    )
    expect(page.getByRole('listitem').elements()).toHaveLength(3)
    expect(page.getByRole('link', { name: 'Docs' }).elements()).toHaveLength(2)
    // React warns about duplicate keys through console.error.
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('draws the separator with CSS, outside the accessible names', async () => {
    await render(<Breadcrumbs items={ITEMS} />)
    const second = page.getByRole('listitem').nth(1).element()
    expect(getComputedStyle(second, '::before').content).toContain('/')
    await expect.element(page.getByRole('listitem').nth(1)).toHaveTextContent('web-app')
  })

  it('names a link’s target in a tooltip on keyboard focus', async () => {
    await render(
      <Breadcrumbs
        items={[{ label: 'Acme', href: '/inbox', tooltip: 'Go to Inbox' }, { label: 'Builds' }]}
      />,
    )
    const link = page.getByRole('link', { name: 'Acme' })
    await userEvent.tab()
    await expect.element(link).toHaveFocus()
    // Base UI opens a focus tooltip only from a real focus event on a document that has focus, and
    // ignores a focus that arrives while the window is blurred (parallel browser pages on a busy
    // machine take focus from each other). `toHaveFocus` only reads `document.activeElement`, so
    // when the tooltip hasn't opened, move focus off and back with the keyboard, as a user would.
    await expect
      .poll(async () => {
        if (page.getByText('Go to Inbox').elements().length > 0) return true
        link.element().blur()
        await userEvent.tab()
        return page.getByText('Go to Inbox').elements().length > 0
      })
      .toBe(true)
    await expect.element(page.getByText('Go to Inbox')).toBeVisible()
  })
})
