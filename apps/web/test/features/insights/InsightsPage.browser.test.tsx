import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { validateInsightsSearch } from '#features/insights/api.ts'
import { InsightsPage } from '#features/insights/InsightsPage.tsx'
import { fakeFetch, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

afterEach(() => restoreFetch())

const summary = (over: Record<string, unknown> = {}) => ({
  medianReviewHours: 3.4,
  p90ReviewHours: 11,
  buildsReviewed: 186,
  reviewedOverTarget: 4,
  buildsFinished: 400,
  buildsWithChanges: 92,
  changeRate: 0.23,
  ...over,
})

const report = {
  workspace: { slug: 'acme', name: 'Acme' },
  team: null,
  range: { from: '2026-10-09T00:00:00.000Z', to: '2026-11-08T00:00:00.000Z' },
  summary: summary(),
  previous: summary({ medianReviewHours: 6.1, buildsReviewed: 166 }),
  weeks: [
    { weekStart: '2026-10-26T00:00:00.000Z', medianReviewHours: 5, reviews: 20, flaky: 12 },
    { weekStart: '2026-11-02T00:00:00.000Z', medianReviewHours: 3, reviews: 30, flaky: 7 },
  ],
  storage: {
    totalBytes: 3 * 1024 ** 3,
    teams: [
      { slug: 'web', name: 'Web', bytes: 2 * 1024 ** 3 },
      { slug: 'docs', name: 'Docs', bytes: 1024 ** 3 },
    ],
  },
  reviewers: [
    {
      id: 'u1',
      name: 'Ada Lovelace',
      openRequests: 2,
      overdue: 1,
      reviews: 40,
      medianResponseHours: 2.5,
    },
  ],
}

const show = (url = '/workspaces/acme/insights') =>
  renderPage(<InsightsPage />, {
    route: '/workspaces/$workspace/insights',
    url,
    announcer: true,
    validateSearch: validateInsightsSearch,
  })

describe('InsightsPage', () => {
  it('shows tiles with their change, charts as text, storage and reviewers', async () => {
    const calls = fakeFetch({
      'GET /api/workspaces/acme/insights': report,
      'GET /api/workspaces/acme/sidebar': { teams: [], views: [], inboxUnread: 0, reviews: 0 },
    })
    await show('/workspaces/acme/insights?range=7')
    await expect.element(page.getByText('3.4h')).toBeVisible()
    await expect.element(page.getByLabelText('Down 44%, better')).toBeVisible()
    await expect
      .element(
        page.getByRole('img', { name: /Median time to review, per week\. .*from 5\.0h to 3\.0h/ }),
      )
      .toBeVisible()
    await expect
      .element(page.getByRole('img', { name: /Open flaky snapshots fell from 12 to 7/ }))
      .toBeVisible()
    await expect.element(page.getByRole('cell', { name: 'Ada Lovelace' })).toBeVisible()
    await expect.element(page.getByText('3.0 GB total')).toBeVisible()
    const request = calls.find((c) => c.path === '/api/workspaces/acme/insights')
    expect(request).toBeDefined()
    await userEvent.click(page.getByRole('button', { name: '90 days' }))
    await expect
      .element(page.getByRole('button', { name: '90 days' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('says so when there is nothing to show', async () => {
    fakeFetch({
      'GET /api/workspaces/acme/insights': {
        ...report,
        summary: summary({ buildsFinished: 0, buildsReviewed: 0, changeRate: null }),
        storage: { totalBytes: 0, teams: [] },
        reviewers: [],
        weeks: [],
      },
      'GET /api/workspaces/acme/sidebar': { teams: [], views: [], inboxUnread: 0, reviews: 0 },
    })
    await show()
    await expect.element(page.getByRole('heading', { name: 'No data yet' })).toBeVisible()
  })
})
