import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { BaselinesPage } from '#features/baselines/BaselinesPage.tsx'
import { fakeFetch, json } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const PATH = '/api/teams/acme/web/baselines'
const FLAKY = '/api/teams/acme/web/flaky'
const noFlaky = json({ builds: 10, flaky: [] })
const open = () =>
  renderPage(<BaselinesPage />, {
    route: '/$workspace/$team/baselines/',
    url: '/acme/web/baselines',
    announcer: true,
  })

const item = (name: string, buildName: string, buildNumber: number) => ({
  name,
  buildName,
  width: 400,
  height: 300,
  sizeBytes: 20_480,
  fileSha256: `${name}-f`,
  thumbnailSha256: `${name}-t`,
  buildNumber,
  commitSha: 'abcdef1',
  approvedAt: '2026-11-08T10:00:00.000Z',
  approvedBy: null,
})

const list = (baselines: unknown[]) => ({
  team: { slug: 'web', name: 'Web', defaultBranch: 'main' },
  baselines,
})

describe('BaselinesPage', () => {
  it('groups baselines by name prefix, links to the baseline page (and its build) and searches', async () => {
    fakeFetch({
      [`GET ${PATH}`]: list([
        item('checkout/payment', 'default', 12),
        item('checkout/summary', 'default', 11),
        item('home', 'default', 9),
      ]),
      [`GET ${FLAKY}`]: noFlaky,
    })
    await open()
    await expect.element(page.getByRole('heading', { name: /checkout/ })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: /Ungrouped/ })).toBeVisible()
    await expect.element(page.getByText('3 on main')).toBeVisible()
    const link = page.getByRole('link', { name: /checkout\/payment/ })
    await expect.element(link).toHaveAttribute('href', '/acme/web/baselines/checkout/payment')
    await expect
      .element(page.getByRole('link', { name: /^Build #12/ }))
      .toHaveAttribute('href', '/acme/web/builds/12')

    const search = page.getByRole('textbox', { name: 'Search baselines' })
    await expect.element(search).toHaveAttribute('placeholder', 'Search screenshots')
    await userEvent.fill(search, 'home')
    await expect.element(page.getByText('1 on main')).toBeVisible()
    await expect.element(page.getByRole('link', { name: /checkout/ })).not.toBeInTheDocument()

    await userEvent.fill(search, 'zzz')
    await expect.element(page.getByText('No baseline matches “zzz”')).toBeVisible()
  })

  it('marks a flaky screenshot in the last column, and shows the age compactly', async () => {
    fakeFetch({
      [`GET ${PATH}`]: list([
        {
          ...item('checkout/payment', 'default', 12),
          approvedAt: new Date(Date.now() - 2 * 24 * 3600_000).toISOString(),
        },
        {
          ...item('checkout/summary', 'default', 11),
          approvedAt: new Date(Date.now() - 3600_000).toISOString(),
        },
      ]),
      [`GET ${FLAKY}`]: json({ builds: 10, flaky: [{ name: 'checkout/payment', changedIn: 4 }] }),
    })
    await open()
    await expect.element(page.getByText('2d')).toBeVisible()
    await expect.element(page.getByText('1h')).toBeVisible()
    const marks = page.getByRole('img', { name: 'Flaky: changed in 4 of the last 10 builds' })
    await expect.element(marks).toBeVisible()
    expect(marks.elements()).toHaveLength(1)
  })

  it('says so when there are none', async () => {
    fakeFetch({ [`GET ${PATH}`]: list([]), [`GET ${FLAKY}`]: noFlaky })
    await open()
    await expect.element(page.getByText('No baselines yet')).toBeVisible()
  })

  it('shows an error with a retry', async () => {
    fakeFetch({ [`GET ${PATH}`]: json({ error: 'boom' }, 500) })
    await open()
    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })
})
