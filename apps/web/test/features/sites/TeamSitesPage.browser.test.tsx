import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { TeamSitesPage } from '#features/sites/TeamSitesPage.tsx'
import { fakeFetch, restoreFetch, json, pending } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

afterEach(() => restoreFetch())

const API = 'GET /api/teams/acme/web/sites'
const open = () =>
  renderPage(<TeamSitesPage />, { route: '/$workspace/$team/sites', url: '/acme/web/sites' })

const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
const site = {
  slug: 'storybook',
  name: 'Storybook',
  kindLabel: 'Storybook',
  branches: [
    {
      branch: 'main',
      address: 'https://acme--web--main.sites.test',
      commitSha: 'abcdef1234567',
      updatedAt: iso(10),
    },
  ],
  versions: [
    {
      commitSha: 'abcdef1234567',
      address: 'https://acme--web--abcdef1.sites.test',
      branch: 'main',
      totalBytes: 2.5 * 1024 * 1024,
      createdAt: iso(10),
    },
    {
      commitSha: '1111111222222',
      address: null,
      branch: null,
      totalBytes: 800,
      createdAt: iso(500),
    },
  ],
}

describe('TeamSitesPage', () => {
  it('holds a skeleton under the header while loading', async () => {
    fakeFetch({ [API]: pending })
    await open()
    await expect.element(page.getByRole('heading', { name: 'web sites', level: 1 })).toBeVisible()
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull()
  })

  it('has breadcrumbs back to Teams and the team', async () => {
    fakeFetch({ [API]: { configured: true, sites: [site] } })
    await open()
    const trail = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect.element(trail.getByRole('link', { name: 'Teams' })).toHaveAttribute('href', '/')
    await expect
      .element(trail.getByRole('link', { name: 'web' }))
      .toHaveAttribute('href', '/acme/web')
    await expect.element(trail.getByText('Sites')).toHaveAttribute('aria-current', 'page')
  })

  it('lists branches and uploads, linking out to the sites', async () => {
    fakeFetch({ [API]: { configured: true, sites: [site] } })
    await open()
    await expect.element(page.getByRole('heading', { name: 'Storybook', level: 2 })).toBeVisible()
    const main = page.getByRole('link', { name: 'main' })
    await expect.element(main).toHaveAttribute('href', 'https://acme--web--main.sites.test')
    await expect.element(main).toHaveAttribute('target', '_blank')
    await expect
      .element(page.getByRole('link', { name: 'abcdef1' }))
      .toHaveAttribute('href', 'https://acme--web--abcdef1.sites.test')
    await expect.element(page.getByText(/main · 2\.5 MB/)).toBeVisible()
    // An upload with no address is plain text, not a link.
    await expect.element(page.getByText('1111111')).toBeVisible()
    await expect.element(page.getByRole('link', { name: '1111111' })).not.toBeInTheDocument()
    await expect.element(page.getByText(/1 kB/)).toBeVisible()
  })

  it('says when hosting is not configured on the server', async () => {
    fakeFetch({ [API]: { configured: false, sites: [] } })
    await open()
    await expect
      .element(
        page.getByText(
          'Static site hosting isn’t set up on this server. Set STATIC_SITES_HOST to a separate domain to turn it on.',
        ),
      )
      .toBeVisible()
  })

  it('shows an empty state with the upload command', async () => {
    fakeFetch({ [API]: { configured: true, sites: [] } })
    await open()
    await expect.element(page.getByRole('heading', { name: 'No sites yet' })).toBeVisible()
    await expect.element(page.getByText(/npx circi storybook upload/)).toBeVisible()
  })

  it('says the team does not exist for a 404', async () => {
    fakeFetch({ [API]: json({ error: 'nope' }, 404) })
    await open()
    await expect.element(page.getByText('This team doesn’t exist')).toBeVisible()
  })

  it('offers a retry for other errors', async () => {
    let fail = true
    fakeFetch({
      [API]: () => (fail ? json({ error: 'boom' }, 500) : { configured: true, sites: [site] }),
    })
    await open()
    await expect.element(page.getByText('boom')).toBeVisible()
    fail = false
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.element(page.getByRole('heading', { name: 'Storybook' })).toBeVisible()
  })
})
