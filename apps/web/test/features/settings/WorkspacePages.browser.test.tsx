import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it.
const auth = vi.hoisted(() => ({
  getFullOrganization: vi.fn<(arg: unknown) => Promise<unknown>>(),
}))
vi.mock('#lib/auth-client.ts', () => ({ authClient: { organization: auth } }))

import { WorkspaceGeneralPage } from '#features/settings/WorkspaceGeneralPage.tsx'
import { WorkspaceStoragePage } from '#features/settings/WorkspaceStoragePage.tsx'
import { fakeApi, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

afterEach(() => restoreFetch())

describe('WorkspaceGeneralPage', () => {
  it('shows the details read-only and says renaming is unavailable', async () => {
    await page.viewport(1000, 800)
    auth.getFullOrganization.mockResolvedValue({
      data: { id: 'o1', name: 'Acme Inc', slug: 'acme', members: [{}, {}], invitations: [] },
      error: null,
    })
    await renderPage(<WorkspaceGeneralPage />, {
      route: '/workspaces/$workspace/settings',
      url: '/workspaces/acme/settings',
    })
    await expect.element(page.getByText('Acme Inc').first()).toBeVisible()
    await expect.element(page.getByText('acme', { exact: true })).toBeVisible()
    await expect.element(page.getByText(/isn’t available yet/)).toBeVisible()
    expect(page.getByRole('textbox').elements()).toHaveLength(0)
  })
})

describe('WorkspaceStoragePage', () => {
  it('lists teams by size and points retention to team settings', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      'GET /api/workspaces/acme/insights': {
        body: {
          workspace: { slug: 'acme', name: 'Acme Inc' },
          storage: {
            totalBytes: 4_000_000,
            teams: [
              { slug: 'docs', name: 'Docs', bytes: 1_000_000 },
              { slug: 'web', name: 'Web App', bytes: 3_000_000 },
            ],
          },
        },
      },
    })
    await renderPage(<WorkspaceStoragePage />, {
      route: '/workspaces/$workspace/settings/storage',
      url: '/workspaces/acme/settings/storage',
    })
    const rows = page.getByRole('list', { name: 'Storage by team' }).getByRole('listitem')
    await expect.element(rows.first()).toHaveTextContent('Web App3 MB')
    await expect.element(rows.last()).toHaveTextContent('Docs1 MB')
    await expect.element(page.getByText(/Keep builds for/)).toBeVisible()
  })
})
