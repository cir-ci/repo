import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { TeamSitesPage } from '#features/sites/TeamSitesPage.tsx'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { fakeFetch, json, pending } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'
import { toastNamed } from '#test/support/toast.ts'

const API = 'GET /api/teams/acme/web/sites'
const open = () =>
  renderPage(<TeamSitesPage />, { route: '/$workspace/$team/sites', url: '/acme/web/sites' })

const list = (sites: unknown[], canManage = true) => ({
  configured: true,
  dnsTarget: 'custom.sites.test',
  canManage,
  sites,
})
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
const site = {
  slug: 'storybook',
  customDomain: null,
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
    await expect.element(page.getByRole('heading', { name: 'Sites', level: 1 })).toBeVisible()
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull()
  })

  it("has breadcrumbs to the workspace Inbox and the team's Builds", async () => {
    fakeFetch({ [API]: list([site]) })
    await open()
    const trail = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect
      .element(trail.getByRole('link', { name: 'acme' }))
      .toHaveAttribute('href', '/inbox')
    await expect
      .element(trail.getByRole('link', { name: 'web' }))
      .toHaveAttribute('href', '/acme/web')
    await expect.element(trail.getByText('Sites')).toHaveAttribute('aria-current', 'page')
  })

  it('lists branches and uploads, linking out to the sites', async () => {
    fakeFetch({ [API]: list([site]) })
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
    fakeFetch({
      [API]: { configured: false, dnsTarget: null, canManage: true, sites: [] },
      'GET /api/capabilities': { instanceAdmin: true },
    })
    await open()
    await expect
      .element(
        page.getByText(
          "Static site hosting isn't set up on this server. Set STATIC_SITES_HOST to a separate domain to turn it on.",
        ),
      )
      .toBeVisible()
  })

  it('does not show the variable name to people who cannot change server settings', async () => {
    fakeFetch({
      [API]: { configured: false, dnsTarget: null, canManage: true, sites: [] },
      'GET /api/capabilities': { instanceAdmin: false },
    })
    await open()
    await expect.element(page.getByText(/Ask an instance admin to turn it on/)).toBeVisible()
    expect(document.body.textContent).not.toContain('STATIC_SITES_HOST')
  })

  it('shows an empty state with the upload command', async () => {
    fakeFetch({ [API]: list([]) })
    await open()
    const root = await expectEmptyState('No sites yet', {
      body: 'Upload a built Storybook or report from CI.',
      action: 'Copy',
    })
    await expect.element(page.getByText(/npx circi storybook upload/)).toBeVisible()
    // Settings aren't linked from an app page.
    expect(root.querySelector('a')).toBeNull()
    expect(root.textContent).not.toMatch(/settings/i)
  })

  it('says the team does not exist for a 404', async () => {
    fakeFetch({ [API]: json({ error: 'nope' }, 404) })
    await open()
    await expect.element(page.getByText("This team doesn't exist")).toBeVisible()
  })

  it('offers a retry for other errors', async () => {
    let fail = true
    fakeFetch({
      [API]: () => (fail ? json({ error: 'boom' }, 500) : list([site])),
    })
    await open()
    await expect.element(page.getByText('boom')).toBeVisible()
    fail = false
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.element(page.getByRole('heading', { name: 'Storybook' })).toBeVisible()
  })
})

const withDomain = (verified: boolean) => ({
  ...site,
  customDomain: {
    domain: 'storybook.acme.com',
    verified,
    verifiedAt: verified ? iso(5) : null,
    address: 'https://storybook.acme.com',
  },
})

describe("a site's custom domain", () => {
  const DOMAIN_API = 'PUT /api/teams/acme/web/sites/storybook/domain'
  const VERIFY_API = 'POST /api/teams/acme/web/sites/storybook/domain/verify'
  const REMOVE_API = 'DELETE /api/teams/acme/web/sites/storybook/domain'
  it('offers a form when there is no domain, and sends it', async () => {
    let current: unknown = list([site])
    const calls = fakeFetch({
      [API]: () => current,
      [DOMAIN_API]: () => {
        current = list([withDomain(false)])
        return withDomain(false).customDomain
      },
    })
    await open()
    await expect.element(page.getByRole('heading', { name: 'Custom domain' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Domain' }).fill(' Storybook.acme.com ')
    await page.getByRole('button', { name: 'Save domain' }).click()

    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ domain: 'Storybook.acme.com' })
    // Saved: it shows as not verified, with the CNAME to add and where it points.
    await expect.element(page.getByText('Not verified')).toBeVisible()
    const record = page.getByLabelText('DNS record')
    await expect.element(record.getByText('CNAME')).toBeVisible()
    await expect.element(record.getByText('storybook.acme.com')).toBeVisible()
    await expect.element(record.getByText('custom.sites.test')).toBeVisible()
  })

  it('shows what is wrong when the server refuses the domain', async () => {
    fakeFetch({
      [API]: list([site]),
      [DOMAIN_API]: json({ error: 'domain: ci.acme.io must differ from the dashboard host' }, 400),
    })
    await open()
    await page.getByRole('textbox', { name: 'Domain' }).fill('ci.acme.io')
    await page.getByRole('button', { name: 'Save domain' }).click()
    await expect.element(page.getByText(/must differ from the dashboard host/)).toBeVisible()
  })

  it('checks DNS, says why it is not verified yet, and then shows it verified and linked', async () => {
    let verified = false
    fakeFetch({
      [API]: () => list([withDomain(verified)]),
      [VERIFY_API]: () => {
        const answer = verified
          ? { domain: 'storybook.acme.com', verified: true, verifiedAt: iso(0), error: null }
          : {
              domain: 'storybook.acme.com',
              verified: false,
              verifiedAt: null,
              error: 'No DNS record found for storybook.acme.com.',
            }
        return answer
      },
    })
    await open()
    await expect.element(page.getByText('Not verified')).toBeVisible()
    await page.getByRole('button', { name: 'Check DNS' }).click()
    await expect
      .element(page.getByText('No DNS record found for storybook.acme.com.'))
      .toBeVisible()

    verified = true
    await page.getByRole('button', { name: 'Check DNS' }).click()
    await expect.element(page.getByText('Verified')).toBeVisible()
    await expect
      .element(page.getByRole('link', { name: 'storybook.acme.com' }))
      .toHaveAttribute('href', 'https://storybook.acme.com')
    await expect.element(page.getByRole('button', { name: 'Check DNS' })).not.toBeInTheDocument()
  })

  it('removes the domain', async () => {
    let current: unknown = list([withDomain(true)])
    const calls = fakeFetch({
      [API]: () => current,
      [REMOVE_API]: () => {
        current = list([site])
        return new Response(null, { status: 204 })
      },
    })
    await open()
    await page.getByRole('button', { name: 'Remove storybook.acme.com' }).click()
    // Irreversible and risky: it asks first, and Cancel leaves the domain.
    const dialog = page.getByRole('alertdialog', { name: 'Remove storybook.acme.com?' })
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    await page.getByRole('button', { name: 'Remove storybook.acme.com' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click()
    await expect.poll(() => calls.some((c) => c.method === 'DELETE')).toBe(true)
    await expect.element(page.getByRole('textbox', { name: 'Domain' })).toBeVisible()
    await expect.element(toastNamed('Custom domain removed')).toBeVisible()
  })

  it('lets a plain member see the domain but not change it', async () => {
    fakeFetch({ [API]: list([withDomain(false)], false) })
    await open()
    await expect.element(page.getByText('storybook.acme.com').first()).toBeVisible()
    await expect.element(page.getByText('Not verified')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Check DNS' })).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Change' })).not.toBeInTheDocument()
    await expect.element(page.getByRole('textbox', { name: 'Domain' })).not.toBeInTheDocument()
  })
})
