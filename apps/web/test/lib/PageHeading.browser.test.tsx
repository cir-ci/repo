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

describe('PageTitle', () => {
  it('is a hidden h1 that assistive technology still reads', async () => {
    await renderPage(<PageTitle>Sign in</PageTitle>)
    const h1 = page.getByRole('heading', { level: 1, name: 'Sign in' })
    await expect.element(h1).toBeInTheDocument()
    expect(h1.element().getBoundingClientRect().width).toBeLessThanOrEqual(1)
  })
})
