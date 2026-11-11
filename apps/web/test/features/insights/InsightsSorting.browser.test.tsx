import type { Insights } from '@circi/api'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { validateInsightsSearch } from '#features/insights/api.ts'
import { InsightsPage } from '#features/insights/InsightsPage.tsx'
import { fakeFetch } from '#test/support/fetch.ts'
import { sidebarModel } from '#test/support/fixtures.ts'
import { renderPage } from '#test/support/render.tsx'

import { fullReport } from './fixtures.ts'

const show = (report: Insights.Report, url = '/workspaces/acme/insights?range=90') => {
  fakeFetch({
    'GET /api/workspaces/acme/insights': report,
    'GET /api/workspaces/acme/sidebar': sidebarModel({ projects: [] }),
  })
  return renderPage(<InsightsPage />, {
    route: '/workspaces/$workspace/insights',
    url,
    announcer: true,
    validateSearch: validateInsightsSearch,
  })
}

const card = (name: string) => page.getByRole('region', { name, exact: true })

/** The first cell of each body row, in the order shown. */
const firstColumn = async (name: string) => {
  await expect.element(card(name).getByRole('table')).toBeVisible()
  return [...card(name).element().querySelectorAll('tbody tr')].map((tr) =>
    tr.querySelector('th')?.textContent?.trim(),
  )
}

describe('sortable tables on Insights', () => {
  it('sorts Projects by a column, and keeps the sort in the address', async () => {
    const { router } = await show(fullReport())
    const sortParam = () => router.state.location.search.sort
    const projects = card('Projects')
    await expect.element(projects.getByRole('columnheader', { name: 'Builds' })).toBeVisible()
    expect(await firstColumn('Projects')).toEqual(['Web', 'Docs'])

    const builds = projects.getByRole('columnheader', { name: 'Builds' })
    await userEvent.click(builds.getByRole('button'))
    await expect.element(builds).toHaveAttribute('aria-sort', 'ascending')
    expect(await firstColumn('Projects')).toEqual(['Docs', 'Web'])
    await expect.poll(sortParam).toBe('projects:builds')

    await userEvent.click(builds.getByRole('button'))
    await expect.element(builds).toHaveAttribute('aria-sort', 'descending')
    expect(await firstColumn('Projects')).toEqual(['Web', 'Docs'])
    await expect.poll(sortParam).toBe('projects:-builds')

    await userEvent.click(builds.getByRole('button'))
    await expect.element(builds).toHaveAttribute('aria-sort', 'none')
    await expect.poll(sortParam).toBeUndefined()
  })

  it('sorts by text, and puts a missing value last either way', async () => {
    await show(fullReport())
    const projects = card('Projects')
    const project = projects.getByRole('columnheader', { name: 'Project' })
    await userEvent.click(project.getByRole('button'))
    expect(await firstColumn('Projects')).toEqual(['Docs', 'Web'])
    await userEvent.click(project.getByRole('button'))
    expect(await firstColumn('Projects')).toEqual(['Web', 'Docs'])

    // The oldest-waiting list: the second build has no author.
    const waiting = card('Oldest waiting builds')
    const author = waiting.getByRole('columnheader', { name: 'Author' })
    await userEvent.click(author.getByRole('button'))
    expect(await firstColumn('Oldest waiting builds')).toEqual(['#418', '#420'])
    await userEvent.click(author.getByRole('button'))
    expect(await firstColumn('Oldest waiting builds')).toEqual(['#418', '#420'])
  })

  it('sorts the lists by a count, and a table can be sorted without moving another', async () => {
    await show(fullReport())
    const rejected = card('Rejected most often')
    expect(await firstColumn('Rejected most often')).toEqual(['checkout/summary', 'home/hero'])
    await userEvent.click(
      rejected.getByRole('columnheader', { name: 'Rejected' }).getByRole('button'),
    )
    expect(await firstColumn('Rejected most often')).toEqual(['home/hero', 'checkout/summary'])
    // The Projects table keeps its own order.
    expect(await firstColumn('Projects')).toEqual(['Web', 'Docs'])
  })

  it('sorts Reviewer load by a duration', async () => {
    const base = fullReport()
    const ada = base.reviewers[0]!
    await show(
      fullReport({
        reviewers: [
          { ...ada, id: 'u1', name: 'Ada Lovelace', medianResponseHours: 2.5 },
          { ...ada, id: 'u2', name: 'Grace Hopper', medianResponseHours: 0.5 },
          { ...ada, id: 'u3', name: 'Alan Turing', medianResponseHours: null },
        ],
      }),
    )
    const load = card('Reviewer load')
    const response = load.getByRole('columnheader', { name: 'Median response' })
    await userEvent.click(response.getByRole('button'))
    expect(await firstColumn('Reviewer load')).toEqual([
      'Grace Hopper',
      'Ada Lovelace',
      'Alan Turing',
    ])
    await userEvent.click(response.getByRole('button'))
    expect(await firstColumn('Reviewer load')).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
      'Alan Turing',
    ])
  })

  it('sorts a chart\'s "View as table" by the figure in a column', async () => {
    await show(fullReport())
    const c = card('Median time to first review')
    await userEvent.click(c.getByRole('button', { name: 'View as table' }))
    const medians = () =>
      [...c.element().querySelectorAll('tbody tr')].map(
        (tr) => tr.querySelectorAll('td')[0]?.textContent,
      )
    const before = medians()
    const header = c.getByRole('columnheader', { name: 'Median' })
    await userEvent.click(header.getByRole('button'))
    const ascending = medians()
    expect(ascending.toSorted((a, b) => parseFloat(a ?? '') - parseFloat(b ?? ''))).toEqual(
      ascending,
    )
    await userEvent.click(header.getByRole('button'))
    await userEvent.click(header.getByRole('button'))
    expect(medians()).toEqual(before)
  })
})
