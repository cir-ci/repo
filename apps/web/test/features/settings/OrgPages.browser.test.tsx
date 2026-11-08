import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it.
const auth = vi.hoisted(() => ({
  getFullOrganization: vi.fn<(arg: unknown) => Promise<unknown>>(),
}))
vi.mock('../../../src/lib/auth-client.ts', () => ({ authClient: { organization: auth } }))

import { OrgGeneralPage } from '../../../src/features/settings/OrgGeneralPage.tsx'
import { OrgStoragePage } from '../../../src/features/settings/OrgStoragePage.tsx'
import { renderPage } from '../../support/render.tsx'
import { fakeApi, restoreFetch } from '../fetch-routes.ts'

afterEach(() => restoreFetch())

describe('OrgGeneralPage', () => {
  it('shows the details read-only and says renaming is unavailable', async () => {
    await page.viewport(1000, 800)
    auth.getFullOrganization.mockResolvedValue({
      data: { id: 'o1', name: 'Acme Inc', slug: 'acme', members: [{}, {}], invitations: [] },
      error: null,
    })
    await renderPage(<OrgGeneralPage />, {
      route: '/organizations/$org/settings',
      url: '/organizations/acme/settings',
    })
    await expect.element(page.getByText('Acme Inc').first()).toBeVisible()
    await expect.element(page.getByText('acme', { exact: true })).toBeVisible()
    await expect.element(page.getByText(/isn’t available yet/)).toBeVisible()
    expect(page.getByRole('textbox').elements()).toHaveLength(0)
  })
})

describe('OrgStoragePage', () => {
  it('lists projects by size and points retention to project settings', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      'GET /api/orgs/acme/insights': {
        body: {
          org: { slug: 'acme', name: 'Acme Inc' },
          storage: {
            totalBytes: 4_000_000,
            projects: [
              { slug: 'docs', name: 'Docs', bytes: 1_000_000 },
              { slug: 'web', name: 'Web App', bytes: 3_000_000 },
            ],
          },
        },
      },
    })
    await renderPage(<OrgStoragePage />, {
      route: '/organizations/$org/settings/storage',
      url: '/organizations/acme/settings/storage',
    })
    const rows = page.getByRole('list', { name: 'Storage by project' }).getByRole('listitem')
    await expect.element(rows.first()).toHaveTextContent('Web App3 MB')
    await expect.element(rows.last()).toHaveTextContent('Docs1 MB')
    await expect.element(page.getByText(/Keep builds for/)).toBeVisible()
  })
})
