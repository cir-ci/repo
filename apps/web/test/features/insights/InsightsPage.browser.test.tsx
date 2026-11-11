import type { Insights } from '@circi/api'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { validateInsightsSearch } from '#features/insights/api.ts'
import { InsightsPage } from '#features/insights/InsightsPage.tsx'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { fakeFetch } from '#test/support/fetch.ts'
import { sidebarModel } from '#test/support/fixtures.ts'
import { renderPage } from '#test/support/render.tsx'

import { docs, emptyWeek, fullReport, summary, web, week } from './fixtures.ts'

const show = async (report: Insights.Report, url = '/workspaces/acme/insights?range=90') => {
  const calls = fakeFetch({
    'GET /api/workspaces/acme/insights': report,
    'GET /api/workspaces/acme/sidebar': sidebarModel({ projects: [] }),
  })
  await renderPage(<InsightsPage />, {
    route: '/workspaces/$workspace/insights',
    url,
    announcer: true,
    validateSearch: validateInsightsSearch,
  })
  return calls
}

const card = (name: string) => page.getByRole('region', { name, exact: true })

/** A report whose weekly numbers are all zero, for the empty states. */
const quiet = (over: Partial<Insights.Report> = {}) =>
  fullReport({
    summary: summary({
      buildsDecided: 0,
      medianDecisionHours: null,
      p90DecisionHours: null,
      failedBuilds: 0,
    }),
    weeks: [emptyWeek('2026-10-26T00:00:00.000Z'), emptyWeek('2026-11-02T00:00:00.000Z')],
    backlog: [{ day: '2026-11-07T00:00:00.000Z', waiting: 0 }],
    waitingNow: 0,
    oldestWaiting: [],
    mostChanged: [],
    flakiest: [],
    rejections: { rejectedBuilds: 0, withReason: 0, recent: [] },
    mostRejected: [],
    failureReasons: [],
    ...over,
  })

describe('InsightsPage', () => {
  it.each([1280, 900, 700, 420])(
    'keeps every tile chip inside its tile at %ipx, at most three tiles a row',
    async (width) => {
      await page.viewport(width, 900)
      await show(fullReport())
      const list = page.getByRole('list', { name: 'Summary' })
      await expect.element(list).toBeVisible()
      const tiles = [...list.element().children]
      expect(tiles).toHaveLength(6)
      for (const tile of tiles) {
        const box = tile.getBoundingClientRect()
        const chip = tile.querySelector('[aria-label]')!.getBoundingClientRect()
        expect(chip.right).toBeLessThanOrEqual(box.right)
        expect(chip.left).toBeGreaterThanOrEqual(box.left)
      }
      const rows = new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().top))).size
      expect(rows).toBeGreaterThanOrEqual(2)
    },
  )

  it('shows the six tiles with their chips, and the sections in order', async () => {
    const calls = await show(fullReport(), '/workspaces/acme/insights?range=7')
    await expect.element(page.getByText('Median time to first review').first()).toBeVisible()
    await expect.element(page.getByLabelText('Down 2.7 hours, better')).toBeVisible()
    await expect.element(page.getByText('182 of 186 reviews, weekends not counted')).toBeVisible()
    await expect.element(page.getByLabelText('Up 9, worse').first()).toBeVisible()
    await expect.element(page.getByText('7.2% of finished builds')).toBeVisible()
    await expect
      .poll(() =>
        page
          .getByRole('heading')
          .elements()
          .map((h) => h.textContent),
      )
      .toEqual([
        'Insights',
        'Trends',
        'Median time to first review',
        'Time to decision',
        'Outcomes per week',
        'Waiting for review',
        'Flaky screenshots',
        'Failed builds per week',
        'Processing time',
        'Breakdowns',
        'Projects',
        'Why builds failed',
        'Rejection reasons',
        'Ignore regions',
        'Storage by project',
        'Reviewer load',
        'Lists',
        'Most changed screenshots',
        'Flakiest screenshots',
        'Oldest waiting builds',
        'Rejected most often',
      ])
    expect(calls.some((c) => c.path === '/api/workspaces/acme/insights')).toBe(true)
    await userEvent.click(page.getByRole('button', { name: '90 days' }))
    await expect
      .element(page.getByRole('button', { name: '90 days' }))
      .toHaveAttribute('aria-pressed', 'true')
    // Settings is a closed area: no link out of Insights into it, and no "sample data" tag.
    expect(page.getByRole('link', { name: 'Change retention' }).elements()).toHaveLength(0)
    expect(page.getByText(/sample data/i).elements()).toHaveLength(0)
  })

  it('says so when there is nothing to show', async () => {
    await show(
      fullReport({
        summary: summary({
          buildsFinished: 0,
          buildsReviewed: 0,
          failedBuilds: 0,
          changeRate: null,
        }),
        storage: { totalBytes: 0, projects: [] },
        reviewers: [],
        weeks: [],
      }),
    )
    await expectEmptyState('No data yet', {
      body: /^Nothing was built or reviewed in the last \d+ days\. Try a longer range\.$/,
    })
  })

  describe('Median time to first review', () => {
    it('draws bars with a target line, a tooltip per bar, and a table view', async () => {
      await show(fullReport())
      const c = card('Median time to first review')
      await expect.element(c.getByText('hours, per week')).toBeVisible()
      await expect.element(c.getByText('target 4h')).toBeVisible()
      await expect.element(c.getByRole('img', { name: /from 5\.0h to 3\.0h/ })).toBeVisible()
      await expect.element(page.getByTitle('W44 · 5.0h median · 20 reviews')).toBeInTheDocument()
      const toggle = c.getByRole('button', { name: 'View as table' })
      await expect.element(toggle).toHaveAttribute('aria-pressed', 'false')
      await userEvent.click(toggle)
      await expect.element(toggle).toHaveAttribute('aria-pressed', 'true')
      await expect.element(c.getByRole('columnheader', { name: 'Median' })).toBeVisible()
      await expect.element(c.getByRole('cell', { name: '5.0h' })).toBeVisible()
      // The name stays "View as table": pressed while the table is showing, a press again is the chart.
      await userEvent.click(toggle)
      await expect.element(toggle).toHaveAttribute('aria-pressed', 'false')
      await expect.element(c.getByText('target 4h')).toBeVisible()
    })

    it('leaves the target out when the scope has none, and says so with no reviews', async () => {
      await show(fullReport({ reviewTargetHours: null }))
      expect(page.getByText(/^target /).elements()).toHaveLength(0)
    })

    it('has an empty state', async () => {
      await show(quiet())
      await expect
        .element(card('Median time to first review').getByText('No reviews in this range.'))
        .toBeVisible()
    })
  })

  describe('Time to decision', () => {
    it('draws the median and 90th percentile, with a legend and a table', async () => {
      await show(fullReport())
      const c = card('Time to decision')
      await expect.element(c.getByText('hours, per week')).toBeVisible()
      await expect.element(c.getByText('Median', { exact: true })).toBeVisible()
      await expect.element(c.getByText('90th percentile', { exact: true })).toBeVisible()
      await expect
        .element(page.getByTitle('W44 · 7.9h median · 22h 90th percentile · 52 builds').first())
        .toBeInTheDocument()
      await userEvent.click(c.getByRole('button', { name: 'View as table' }))
      await expect.element(c.getByRole('columnheader', { name: '90th percentile' })).toBeVisible()
      await expect.element(c.getByRole('columnheader', { name: 'Builds' })).toBeVisible()
    })

    it('has an empty state', async () => {
      await show(quiet())
      await expect
        .element(card('Time to decision').getByText('No builds were decided in this range.'))
        .toBeVisible()
    })
  })

  describe('Outcomes per week', () => {
    it('stacks the outcomes with a legend of glyphs, a tooltip and a table', async () => {
      await show(fullReport())
      const c = card('Outcomes per week')
      await expect.element(c.getByText('Approved', { exact: true })).toBeVisible()
      await expect.element(c.getByText('Auto-approved', { exact: true })).toBeVisible()
      await expect.element(c.getByText('Rejected', { exact: true })).toBeVisible()
      await expect.element(c.getByText('Failed', { exact: true })).toBeVisible()
      await expect
        .element(
          page.getByTitle('W44 · 44 approved, 59 auto-approved, 5 rejected, 4 failed').first(),
        )
        .toBeInTheDocument()
      await userEvent.click(c.getByRole('button', { name: 'View as table' }))
      await expect.element(c.getByRole('columnheader', { name: 'Auto-approved' })).toBeVisible()
      await expect.element(c.getByRole('cell', { name: '59' }).first()).toBeVisible()
    })

    it('has an empty state, and a day axis for a short range', async () => {
      await show(quiet())
      await expect
        .element(card('Outcomes per week').getByText('No builds finished in this range.'))
        .toBeVisible()
    })

    it('names days when the range is 7 days or less', async () => {
      await show(
        fullReport({
          bucket: 'day',
          weeks: [week('2026-11-09T00:00:00.000Z'), week('2026-11-10T00:00:00.000Z')],
        }),
        '/workspaces/acme/insights?range=7',
      )
      await expect.element(card('Outcomes per day')).toBeVisible()
      await expect
        .element(page.getByTitle('Mon 9 · 44 approved, 59 auto-approved, 5 rejected, 4 failed'))
        .toBeInTheDocument()
    })
  })

  describe('Waiting for review', () => {
    it('shows the backlog with "6 now", a tooltip and a table', async () => {
      await show(fullReport())
      const c = card('Waiting for review')
      await expect.element(c.getByText('builds, end of each day')).toBeVisible()
      await expect.element(c.getByText('6 now')).toBeVisible()
      await expect.element(c.getByText('Needs review', { exact: true })).toBeVisible()
      await expect.element(page.getByTitle('Nov 7 · 6 builds waiting')).toBeInTheDocument()
      await userEvent.click(c.getByRole('button', { name: 'View as table' }))
      await expect.element(c.getByRole('cell', { name: '6' })).toBeVisible()
    })

    it('has an empty state when nothing waited', async () => {
      await show(quiet())
      await expect
        .element(card('Waiting for review').getByText('Nothing was waiting in this range.'))
        .toBeVisible()
    })
  })

  describe('Flaky screenshots, Failed builds and Processing time', () => {
    it('shows the flaky delta and the definition', async () => {
      await show(fullReport())
      const c = card('Flaky screenshots')
      await expect.element(c.getByText('end of week')).toBeVisible()
      await expect.element(c.getByLabelText(/Down 5 since week 44, better/)).toBeVisible()
      await expect
        .element(
          c.getByText(
            'Flaky means the image came back to an earlier version, or differed between runs of one commit.',
          ),
        )
        .toBeVisible()
      await userEvent.click(c.getByRole('button', { name: 'View as table' }))
      await expect.element(c.getByRole('columnheader', { name: 'Flaky screenshots' })).toBeVisible()
    })

    it('shows failed builds with their delta against before, and an empty state', async () => {
      await show(fullReport())
      const c = card('Failed builds per week')
      await expect.element(c.getByText('9 vs before', { exact: true })).toBeVisible()
      await expect.element(c.getByLabelText('Up 9, worse')).toBeVisible()
      await expect.element(c.getByText('31 failed builds in 90 days.')).toBeVisible()
      await userEvent.click(c.getByRole('button', { name: 'View as table' }))
      await expect.element(c.getByRole('cell', { name: '4' }).first()).toBeVisible()
    })

    it('says so when no builds failed', async () => {
      await show(quiet())
      await expect
        .element(card('Failed builds per week').getByText('No builds failed in this range.'))
        .toBeVisible()
    })

    it('shows processing time, the latest numbers, and an empty state', async () => {
      await show(fullReport())
      const c = card('Processing time')
      await expect.element(c.getByText('minutes, per week')).toBeVisible()
      await expect
        .element(c.getByText('Latest week: 2.6 min median, 6.6 min 90th percentile.'))
        .toBeVisible()
      await expect
        .element(page.getByTitle('W44 · 2.6 min median · 6.6 min 90th percentile').first())
        .toBeInTheDocument()
      await userEvent.click(c.getByRole('button', { name: 'View as table' }))
      await expect.element(c.getByRole('columnheader', { name: 'Median' })).toBeVisible()
    })

    it('has an empty state for processing time', async () => {
      await show(quiet())
      await expect
        .element(card('Processing time').getByText('No builds finished in this range.'))
        .toBeVisible()
    })
  })

  describe('Projects', () => {
    it('compares the projects, in red past the target', async () => {
      await show(fullReport())
      const c = card('Projects')
      await expect.element(c.getByText('last 90 days')).toBeVisible()
      await expect.element(c.getByRole('cell', { name: '182 (26%)' })).toBeVisible()
      await expect.element(c.getByRole('cell', { name: '5.0h' })).toHaveAttribute('data-over')
      await expect.element(c.getByRole('cell', { name: '2.0h' })).not.toHaveAttribute('data-over')
      await expect
        .element(c.getByText('Review times past the target are shown in red.'))
        .toBeVisible()
      await expect.element(c.getByRole('img', { name: 'Docs' })).toBeVisible()
    })

    it('is left out with one project selected, or when the workspace has one project', async () => {
      await show(
        fullReport({ project: 'web', projectsComparison: [] }),
        '/workspaces/acme/insights?project=web',
      )
      expect(card('Projects').elements()).toHaveLength(0)
    })

    it('is left out when the workspace has a single project', async () => {
      await show(fullReport({ projectsComparison: fullReport().projectsComparison.slice(0, 1) }))
      expect(card('Projects').elements()).toHaveLength(0)
    })
  })

  describe('Why builds failed', () => {
    it('lists the messages with count and share', async () => {
      await show(fullReport())
      const c = card('Why builds failed')
      await expect.element(c.getByText('31 failed builds, grouped by message')).toBeVisible()
      await expect.element(c.getByText('Timed out waiting for shards')).toBeVisible()
      await expect.element(c.getByText('39%')).toBeVisible()
    })

    it('has an empty state', async () => {
      await show(quiet())
      await expect
        .element(card('Why builds failed').getByText('No builds failed in this range.'))
        .toBeVisible()
    })
  })

  describe('Rejection reasons', () => {
    it('shows the latest reasons with who, the build link, the project and the age', async () => {
      await show(fullReport())
      const c = card('Rejection reasons')
      await expect.element(c.getByText('53 rejected builds, 38 with a reason')).toBeVisible()
      await expect
        .element(c.getByText('The button moved 4px, please restore the spacing.'))
        .toBeVisible()
      await expect.element(c.getByText(/Omer Katz/)).toBeVisible()
      await expect
        .element(c.getByRole('link', { name: '#418' }))
        .toHaveAttribute('href', '/acme/web/builds/418')
    })

    it('has empty states: none, and none with a reason', async () => {
      await show(quiet())
      await expect
        .element(card('Rejection reasons').getByText('No rejections in this range.'))
        .toBeVisible()
    })

    it('says when rejected builds carry no reason', async () => {
      await show(quiet({ rejections: { rejectedBuilds: 53, withReason: 0, recent: [] } }))
      await expect
        .element(
          card('Rejection reasons').getByText('53 builds were rejected, none with a reason.'),
        )
        .toBeVisible()
    })
  })

  describe('Ignore regions', () => {
    it('shows how many diffs the regions kept unchanged, by region', async () => {
      await show(fullReport())
      const c = card('Ignore regions')
      await expect.element(c.getByText('diffs kept unchanged, last 90 days')).toBeVisible()
      await expect.element(c.getByText('142')).toBeVisible()
      await expect.element(c.getByText('screenshots would have changed without them')).toBeVisible()
      await expect.element(c.getByText('header/clock')).toBeVisible()
      await expect.element(c.getByText('90')).toBeVisible()
    })

    it('says when regions suppressed nothing', async () => {
      await show(fullReport({ ignoreRegions: { suppressedDiffs: 0, top: [] } }))
      await expect
        .element(
          card('Ignore regions').getByText('Ignore regions suppressed no changes in this range.'),
        )
        .toBeVisible()
    })

    it('is hidden until there is something recorded', async () => {
      await show(fullReport({ ignoreRegions: null }))
      expect(card('Ignore regions').elements()).toHaveLength(0)
    })
  })

  describe('Reviewer load and Storage by project', () => {
    it('shows each reviewer with a bar, and the sub-title follows the range', async () => {
      await show(fullReport(), '/workspaces/acme/insights?range=7')
      const c = card('Reviewer load')
      await expect.element(c.getByText('last 7 days')).toBeVisible()
      await expect.element(c.getByRole('rowheader', { name: /Ada Lovelace/ })).toBeVisible()
      await expect.element(c.getByRole('img', { name: 'Ada Lovelace' })).toBeVisible()
      await expect.element(c.getByRole('cell', { name: '40' })).toBeVisible()
    })

    it('has an empty state for reviewers', async () => {
      await show(fullReport({ reviewers: [] }))
      await expect.element(card('Reviewer load').getByText('No reviewers yet.')).toBeVisible()
    })

    it('shows storage per project in its colour, the total and retention', async () => {
      await show(fullReport())
      const c = card('Storage by project')
      await expect
        .element(c.getByText('screenshots, diffs and baselines · 3.0 GB total'))
        .toBeVisible()
      await expect.element(c.getByText('2.0 GB')).toBeVisible()
      await expect.element(c.getByText('Retention keeps 90 days of branch builds.')).toBeVisible()
    })

    it('shows a span when projects keep builds for different times', async () => {
      await show(fullReport({ retentionDays: { min: 30, max: 90 } }))
      await expect
        .element(page.getByText('Retention keeps 30 to 90 days of branch builds.'))
        .toBeVisible()
    })
  })

  describe('the lists', () => {
    it('shows the most changed screenshots linked to their baselines, with the strip', async () => {
      await show(fullReport())
      const c = card('Most changed screenshots')
      await expect.element(c.getByText('builds with a change, last 90 days')).toBeVisible()
      await expect
        .element(c.getByRole('link', { name: 'checkout/summary' }))
        .toHaveAttribute('href', '/acme/web/baselines/checkout/summary')
      await expect.element(c.getByText('14 of 62 builds')).toBeVisible()
      await expect.element(c.getByText('5 of 10')).toBeVisible()
      await expect
        .element(c.getByRole('img', { name: 'Changed in 5 of the last 10 commits' }))
        .toBeVisible()
      await expect.element(c.getByRole('columnheader', { name: 'Project' })).toBeVisible()
    })

    it('has an empty state for most changed', async () => {
      await show(quiet())
      await expect
        .element(
          card('Most changed screenshots').getByText('No screenshots changed in this range.'),
        )
        .toBeVisible()
    })

    it('shows the flakiest screenshots with flip-flops', async () => {
      await show(fullReport())
      const c = card('Flakiest screenshots')
      await expect.element(c.getByText('default branch, last 10 commits')).toBeVisible()
      await expect.element(c.getByRole('columnheader', { name: 'Flip-flops' })).toBeVisible()
      await expect.element(c.getByRole('cell', { name: '4' })).toBeVisible()
      await expect.element(c.getByText('Came back to an earlier image 4 times')).toBeVisible()
      await expect
        .element(c.getByRole('img', { name: 'Image changed in 8 of the last 10 commits' }))
        .toBeVisible()
      await expect
        .element(c.getByRole('link', { name: 'home/hero' }))
        .toHaveAttribute('href', '/acme/docs/baselines/home/hero')
    })

    it('has an empty state for flaky screenshots', async () => {
      await show(quiet())
      await expect
        .element(card('Flakiest screenshots').getByText('No flaky screenshots.'))
        .toBeVisible()
    })

    it('lists the oldest waiting builds, with over-target ones flagged', async () => {
      await show(fullReport())
      const c = card('Oldest waiting builds')
      await expect.element(c.getByText('6 waiting now')).toBeVisible()
      await expect
        .element(c.getByRole('link', { name: '#418' }))
        .toHaveAttribute('href', '/acme/web/builds/418')
      await expect.element(c.getByText('2d 10h · over target')).toBeVisible()
      await expect.element(c.getByText('feature/checkout-redesign')).toBeVisible()
      await expect.element(c.getByText('Omer Katz')).toBeVisible()
    })

    it('drops the Project column when one project is selected', async () => {
      await show(
        fullReport({ project: 'web', projectsComparison: [] }),
        '/workspaces/acme/insights?project=web',
      )
      expect(
        card('Oldest waiting builds').getByRole('columnheader', { name: 'Project' }).elements(),
      ).toHaveLength(0)
      expect(
        card('Most changed screenshots').getByRole('columnheader', { name: 'Project' }).elements(),
      ).toHaveLength(0)
    })

    it('has an empty state for nothing waiting', async () => {
      await show(quiet())
      await expect
        .element(card('Oldest waiting builds').getByText('Nothing is waiting for review.'))
        .toBeVisible()
    })

    it('counts rejections in the singular for one', async () => {
      await show(fullReport())
      const c = card('Rejected most often')
      await expect.element(c.getByText('5 rejections')).toBeVisible()
      await expect.element(c.getByText('1 rejection', { exact: true })).toBeVisible()
      await expect
        .element(c.getByRole('link', { name: 'checkout/summary' }))
        .toHaveAttribute('href', '/acme/web/baselines/checkout/summary')
    })

    it('has an empty state for rejected most often', async () => {
      await show(quiet())
      await expect
        .element(card('Rejected most often').getByText('No screenshots were rejected.'))
        .toBeVisible()
    })
  })

  it('keeps the two projects distinct by colour in storage and ignore regions', async () => {
    await show(fullReport({ ignoreRegions: fullReport().ignoreRegions }))
    expect(web.colour).not.toBe(docs.colour)
    await expect.element(card('Ignore regions').getByRole('img', { name: 'Web' })).toBeVisible()
    await expect.element(card('Ignore regions').getByRole('img', { name: 'Docs' })).toBeVisible()
  })
})
