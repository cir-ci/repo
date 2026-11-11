import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { WorkspacesRedirect } from '#features/instance/WorkspacesRedirect.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

import { workspace } from './fixtures.ts'

const show = () =>
  renderPage(<WorkspacesRedirect />, {
    route: '/instance/workspaces',
    otherRoutes: ['/workspaces/$workspace/settings', '/instance/settings'],
  })

describe('the old Instance Workspaces address', () => {
  it("opens the first live workspace's hub, by name", async () => {
    fakeApi({
      'GET /api/instance/workspaces': {
        body: {
          workspaces: [
            workspace({
              id: 'w0',
              name: 'Aardvark',
              slug: 'aardvark',
              deletedAt: '2026-11-01T00:00:00.000Z',
              daysLeft: 3,
            }),
            workspace({ id: 'w2', name: 'Globex', slug: 'globex' }),
            workspace(),
          ],
        },
      },
    })
    const { router } = await show()
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/acme/settings')
  })

  it('opens Instance settings when there is no workspace', async () => {
    fakeApi({ 'GET /api/instance/workspaces': { body: { workspaces: [] } } })
    const { router } = await show()
    await expect.poll(() => router.state.location.pathname).toBe('/instance/settings')
  })

  it('says so to someone who is not an instance admin', async () => {
    fakeApi({ 'GET /api/instance/workspaces': { status: 403, body: { error: 'Forbidden' } } })
    await show()
    await expect.element(page.getByRole('heading', { name: 'Instance admins only' })).toBeVisible()
  })
})
