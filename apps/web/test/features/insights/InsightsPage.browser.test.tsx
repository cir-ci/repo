import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { validateInsightsSearch } from '#features/insights/api.ts'
import { InsightsPage } from '#features/insights/InsightsPage.tsx'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { fakeFetch } from '#test/support/fetch.ts'
import { sidebarModel } from '#test/support/fixtures.ts'
import { renderPage } from '#test/support/render.tsx'

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
      image: null,
      openRequests: 2,
      overdue: 1,
      reviews: 40,
      medianResponseHours: 2.5,
    },
  ],
  reviewTargetHours: 4 as number | null,
  retentionDays: { min: 90, max: 90 } as { min: number; max: number } | null,
  flakyAfterChanges: 3 as number | null,
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
      'GET /api/workspaces/acme/sidebar': sidebarModel({ teams: [] }),
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
      .element(page.getByRole('img', { name: /Open flaky screenshots fell from 12 to 7/ }))
      .toBeVisible()
    await expect.element(page.getByRole('cell', { name: /Ada Lovelace/ })).toBeVisible()
    await expect
      .element(page.getByText('screenshots, diffs and baselines · 3.0 GB total'))
      .toBeVisible()
    const request = calls.find((c) => c.path === '/api/workspaces/acme/insights')
    expect(request).toBeDefined()
    await userEvent.click(page.getByRole('button', { name: '90 days' }))
    await expect
      .element(page.getByRole('button', { name: '90 days' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('draws the goal at the review target, and no line without one', async () => {
    fakeFetch({
      'GET /api/workspaces/acme/insights': report,
      'GET /api/workspaces/acme/sidebar': sidebarModel({ teams: [] }),
    })
    await show()
    await expect.element(page.getByText('goal 4.0h')).toBeVisible()
  })

  it('leaves the goal out when the scope has no target', async () => {
    fakeFetch({
      'GET /api/workspaces/acme/insights': { ...report, reviewTargetHours: null },
      'GET /api/workspaces/acme/sidebar': sidebarModel({ teams: [] }),
    })
    await show()
    await expect.element(page.getByText('3.4h')).toBeVisible()
    expect(page.getByText(/^goal /).elements()).toHaveLength(0)
  })

  it('labels the cards as the board does, in its order', async () => {
    fakeFetch({
      'GET /api/workspaces/acme/insights': report,
      'GET /api/workspaces/acme/sidebar': sidebarModel({ teams: [] }),
    })
    await show('/workspaces/acme/insights?range=7')
    await expect
      .poll(() =>
        page
          .getByRole('heading', { level: 2 })
          .elements()
          .map((h) => h.textContent),
      )
      .toEqual([
        'Median time to review, per week',
        'Flaky screenshots',
        'Reviewer load',
        'Storage by team',
      ])
    await expect.element(page.getByText('open, end of each week')).toBeVisible()
    await expect
      .element(page.getByLabelText(/Down 5 since week 44, better/))
      .toHaveTextContent('▼ 5 since W44')
    await expect.element(page.getByText('fewer flaky (better)')).toBeVisible()
    await expect.element(page.getByText(/Flaky means changed in 3 of the last 10/)).toBeVisible()
    await expect.element(page.getByText('last 7 days')).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Ada Lovelace' })).toBeVisible()
    await expect.element(page.getByText('Retention keeps 90 days of branch builds.')).toBeVisible()
    // Settings is a closed area: no link out of Insights into it, and no "sample data" tag.
    expect(page.getByRole('link', { name: 'Change retention' }).elements()).toHaveLength(0)
    expect(page.getByText(/sample data/i).elements()).toHaveLength(0)
  })

  it('shows a span when teams keep builds for different times', async () => {
    fakeFetch({
      'GET /api/workspaces/acme/insights': { ...report, retentionDays: { min: 30, max: 90 } },
      'GET /api/workspaces/acme/sidebar': sidebarModel({ teams: [] }),
    })
    await show()
    await expect
      .element(page.getByText('Retention keeps 30 to 90 days of branch builds.'))
      .toBeVisible()
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
      'GET /api/workspaces/acme/sidebar': sidebarModel({ teams: [] }),
    })
    await show()
    await expectEmptyState('No data yet', {
      body: /^Nothing was built or reviewed in the last \d+ days\. Try a longer range\.$/,
    })
  })
})
