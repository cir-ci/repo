import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { PageHeading, PageTitle, projectCrumb, workspaceCrumb } from '#lib/PageHeading.tsx'
import { renderPage } from '#test/support/render.tsx'

describe('PageHeading', () => {
  it("makes the current crumb the page's h1, as plain text", async () => {
    await renderPage(<PageHeading title="Webhooks" />)
    const h1 = page.getByRole('heading', { level: 1 })
    await expect.element(h1).toHaveTextContent('Webhooks')
    await expect.element(h1).toHaveAttribute('aria-current', 'page')
    expect(page.getByRole('heading', { level: 1 }).elements()).toHaveLength(1)
    expect(page.getByRole('link').elements()).toHaveLength(0)
  })

  it('links a workspace crumb to the Inbox and a project crumb to its Builds page, with tooltips', async () => {
    await renderPage(
      <PageHeading
        crumbs={[
          workspaceCrumb({ slug: 'acme', name: 'Acme' }),
          projectCrumb('acme', { slug: 'web', name: 'web-app' }),
        ]}
        title="Webhooks"
      />,
    )
    const nav = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect.element(nav.getByRole('link', { name: 'Acme' })).toHaveAttribute('href', '/inbox')
    await expect
      .element(nav.getByRole('link', { name: 'web-app' }))
      .toHaveAttribute('href', '/acme/web')
    await expect.element(nav.getByRole('heading', { level: 1 })).toHaveTextContent('Webhooks')
    // The sidebar toggle comes first in the bar.
    await userEvent.tab()
    await userEvent.tab()
    await expect.element(page.getByText('Workspace: opens the Inbox')).toBeVisible()
    await userEvent.tab()
    await expect.element(page.getByText('Project: opens its Builds page')).toBeVisible()
  })

  it("shows the page's actions on the right", async () => {
    await renderPage(
      <PageHeading title="Projects" actions={<button type="button">New project</button>} />,
    )
    await expect.element(page.getByRole('button', { name: 'New project' })).toBeVisible()
  })
})

/** The vertical middle of an element: two on one line share it. */
const middle = (el: Element) => {
  const r = el.getBoundingClientRect()
  return r.top + r.height / 2
}

describe('PageHeading on a phone', () => {
  it("keeps the page's buttons on the title's line and moves what follows the title (a branch) below", async () => {
    await renderPage(
      <PageHeading
        crumbs={[
          workspaceCrumb({ slug: 'acme', name: 'Acme' }),
          projectCrumb('acme', { slug: 'web-app', name: 'Web app' }),
        ]}
        title="Build #34"
        after={<span>feat/a-rather-long-branch-name</span>}
        afterOwnRow
        actions={<button type="button">More</button>}
      />,
      { viewport: [390, 844] },
    )
    const title = page.getByRole('heading', { name: 'Build #34' })
    await expect.element(title).toBeVisible()
    const line = middle(title.element())
    // The page's own, and the phone's Search.
    for (const name of ['More', 'Search']) {
      expect(Math.abs(middle(page.getByRole('button', { name }).element()) - line)).toBeLessThan(4)
    }
    // With room left, the title isn't cut short (no spacer shares the line's room with it).
    expect(title.element().scrollWidth).toBeLessThanOrEqual(title.element().clientWidth)
    // The branch wrapped under them.
    expect(
      page.getByText('feat/a-rather-long-branch-name').element().getBoundingClientRect().top,
    ).toBeGreaterThan(title.element().getBoundingClientRect().bottom)
  })
})

describe('PageHeading on a phone, with a count after the title', () => {
  it('keeps the count beside the title and the buttons on the same line', async () => {
    await renderPage(
      <PageHeading
        crumbs={[
          workspaceCrumb({ slug: 'acme', name: 'Acme' }),
          projectCrumb('acme', { slug: 'web-app', name: 'Web app' }),
        ]}
        title="Triage"
        after={<span>5</span>}
      />,
      { viewport: [390, 844] },
    )
    const title = page.getByRole('heading', { name: 'Triage' })
    await expect.element(title).toBeVisible()
    const count = page.getByText('5', { exact: true }).element()
    expect(Math.abs(middle(count) - middle(title.element()))).toBeLessThan(4)
    expect(
      Math.abs(
        middle(page.getByRole('button', { name: 'Search' }).element()) - middle(title.element()),
      ),
    ).toBeLessThan(4)
  })
})

describe('PageTitle', () => {
  it('is a hidden h1 that assistive technology still reads', async () => {
    await renderPage(<PageTitle>Sign in</PageTitle>)
    const h1 = page.getByRole('heading', { level: 1, name: 'Sign in' })
    await expect.element(h1).toBeInTheDocument()
    expect(h1.element().getBoundingClientRect().width).toBeLessThanOrEqual(1)
  })
})
