import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { ViewPage } from '#features/views/ViewPage.tsx'
import { hangingFetch } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const show = (api: NonNullable<Parameters<typeof renderPage>[1]>['api'], id = 'v1') =>
  renderPage(<ViewPage />, {
    route: '/workspaces/$workspace/views/$view',
    url: `/workspaces/acme/views/${id}`,
    announcer: true,
    api,
  })

describe('ViewPage states', () => {
  it("says the view does not exist when it is not in the person's list", async () => {
    await show({ 'GET /api/workspaces/acme/views': { body: { views: [] } } }, 'gone')
    await expect.element(page.getByText("This view doesn't exist")).toBeVisible()
    await expect.element(page.getByText(/deleted, or it belongs to someone else/)).toBeVisible()
    expect(document.title).toBe('View · CirCI')
  })

  it('shows the error with Try again, and loads the views again on retry', async () => {
    const { fake } = await show({
      'GET /api/workspaces/acme/views': { status: 500, body: { error: 'Views are unavailable' } },
    })
    await expect.element(page.getByText("This page couldn't be loaded")).toBeVisible()
    await expect.element(page.getByText('Views are unavailable')).toBeVisible()
    const before = fake?.of('GET').length ?? 0
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.poll(() => fake?.of('GET').length ?? 0).toBeGreaterThan(before)
  })

  it('shows no list or empty state while the views load', async () => {
    hangingFetch()
    await renderPage(<ViewPage />, {
      route: '/workspaces/$workspace/views/$view',
      url: '/workspaces/acme/views/v1',
    })
    expect(page.getByText("This view doesn't exist").elements()).toHaveLength(0)
    expect(page.getByText("This page couldn't be loaded").elements()).toHaveLength(0)
  })
})
