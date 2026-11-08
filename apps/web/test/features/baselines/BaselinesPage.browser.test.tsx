import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { BaselinesPage } from '#features/baselines/BaselinesPage.tsx'
import { fakeFetch, json, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

afterEach(() => restoreFetch())

const PATH = '/api/projects/acme/web/baselines'
const open = () =>
  renderPage(<BaselinesPage />, {
    route: '/$org/$project/baselines',
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
  project: { slug: 'web', name: 'Web', defaultBranch: 'main' },
  baselines,
})

describe('BaselinesPage', () => {
  it('lists baselines by build name, links to the build and filters', async () => {
    fakeFetch({
      [`GET ${PATH}`]: list([item('home', 'default', 12), item('button', 'storybook', 9)]),
    })
    await open()
    await expect.element(page.getByRole('heading', { name: 'default' })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: 'storybook' })).toBeVisible()
    await expect.element(page.getByText('2 baselines on main')).toBeVisible()
    const link = page.getByRole('link', { name: /home/ })
    await expect.element(link).toHaveAttribute('href', '/acme/web/builds/12')
    await expect.element(page.getByText('400 × 300').first()).toBeVisible()
    await expect.element(page.getByText('20 kB').first()).toBeVisible()

    await userEvent.fill(page.getByRole('textbox', { name: 'Filter' }), 'butt')
    await expect.element(page.getByText('1 of 2 baselines on main')).toBeVisible()
    await expect.element(page.getByRole('link', { name: /home/ })).not.toBeInTheDocument()

    await userEvent.fill(page.getByRole('textbox', { name: 'Filter' }), 'zzz')
    await expect.element(page.getByText('No matching baselines')).toBeVisible()
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
