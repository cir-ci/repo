import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { HttpError } from '#lib/http.ts'
import { PageFrame } from '#lib/PageFrame.tsx'
import { renderPage } from '#test/support/render.tsx'

describe('PageFrame', () => {
  it('makes the title the one h1 after the crumbs, and shows the children', async () => {
    await renderPage(
      <PageFrame crumbs={[{ label: 'Account' }]} title="Profile">
        <p>The form</p>
      </PageFrame>,
    )
    const headings = page.getByRole('heading', { level: 1 })
    await expect.element(headings).toHaveTextContent('Profile')
    expect(headings.elements()).toHaveLength(1)
    await expect.element(page.getByText('Account')).toBeVisible()
    await expect.element(page.getByText('The form')).toBeVisible()
  })

  it('shows `forbidden` instead of the children', async () => {
    await renderPage(
      <PageFrame crumbs={[]} title="Webhooks" forbidden={<p>Not for you</p>}>
        <p>The list</p>
      </PageFrame>,
    )
    await expect.element(page.getByText('Not for you')).toBeVisible()
    expect(page.getByText('The list').elements()).toHaveLength(0)
  })

  it('shows the error and retries, without the children', async () => {
    const onRetry = vi.fn<() => void>()
    await renderPage(
      <PageFrame crumbs={[]} title="Webhooks" error={new Error('boom')} onRetry={onRetry}>
        <p>The list</p>
      </PageFrame>,
    )
    await expect.element(page.getByText('boom')).toBeVisible()
    expect(page.getByText('The list').elements()).toHaveLength(0)
    await page.getByRole('button', { name: 'Try again' }).click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("uses the page's own words for a 404", async () => {
    await renderPage(
      <PageFrame
        crumbs={[]}
        title="Webhooks"
        error={new HttpError(404, 'nope')}
        notFound="This team doesn't exist"
      />,
    )
    await expect.element(page.getByText("This team doesn't exist")).toBeVisible()
  })

  it('hides the children while loading and for a forbidden viewer', async () => {
    await renderPage(
      <PageFrame crumbs={[]} title="Health" loading forbidden={<p>Admins only</p>}>
        <p>The list</p>
      </PageFrame>,
    )
    await expect.element(page.getByText('Admins only')).toBeVisible()
    expect(page.getByText('The list').elements()).toHaveLength(0)
  })
})
