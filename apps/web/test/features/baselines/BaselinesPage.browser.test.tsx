import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { BaselinesPage } from '#features/baselines/BaselinesPage.tsx'
import { fakeFetch, json } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const PATH = '/api/teams/acme/web/baselines'
const open = () =>
  renderPage(<BaselinesPage />, {
    route: '/$workspace/$team/baselines',
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
})

const list = (baselines: unknown[]) => ({
  team: { slug: 'web', name: 'Web', defaultBranch: 'main' },
  baselines,
})

describe('BaselinesPage', () => {
  it('groups baselines by name prefix, links to the build and searches', async () => {
    fakeFetch({
      [`GET ${PATH}`]: list([
        item('checkout/payment', 'default', 12),
        item('checkout/summary', 'default', 11),
        item('home', 'default', 9),
      ]),
    })
    await open()
    await expect.element(page.getByRole('heading', { name: /checkout/ })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: /Ungrouped/ })).toBeVisible()
    await expect.element(page.getByText('3 on main')).toBeVisible()
    const link = page.getByRole('link', { name: /checkout\/payment/ })
    await expect.element(link).toHaveAttribute('href', '/acme/web/builds/12')

    const search = page.getByRole('textbox', { name: 'Search baselines' })
    await expect.element(search).toHaveAttribute('placeholder', 'Search snapshots')
    await userEvent.fill(search, 'home')
    await expect.element(page.getByText('1 on main')).toBeVisible()
    await expect.element(page.getByRole('link', { name: /checkout/ })).not.toBeInTheDocument()

    await userEvent.fill(search, 'zzz')
    await expect.element(page.getByText('No baseline matches “zzz”')).toBeVisible()
  })

  it('says so when there are none', async () => {
    fakeFetch({ [`GET ${PATH}`]: list([]) })
    await open()
    await expect.element(page.getByText('No baselines yet')).toBeVisible()
  })

  it('shows an error with a retry', async () => {
    fakeFetch({ [`GET ${PATH}`]: json({ error: 'boom' }, 500) })
    await open()
    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })
})
