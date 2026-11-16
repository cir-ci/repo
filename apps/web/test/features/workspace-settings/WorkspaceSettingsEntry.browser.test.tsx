import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { WorkspaceSettingsEntry } from '#features/workspace-settings/WorkspaceSettingsEntry.tsx'
import { workspace } from '#test/features/instance/fixtures.ts'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const caps = (instanceAdmin: boolean) => ({
  body: {
    canCreateWorkspace: false,
    instanceAdmin,
    manageableWorkspaces: [],
    refusingWorkspaces: [],
    mailConfigured: false,
  },
})

const entry = () =>
  renderPage(<WorkspaceSettingsEntry />, {
    route: '/workspaces/$workspace/settings',
    url: '/workspaces/acme/settings',
    otherRoutes: [
      '/workspaces/$workspace/settings/general',
      '/workspaces/$workspace/settings/members',
      '/workspaces/$workspace/settings/projects',
      '/instance/settings',
    ],
  })

describe('the bare workspace settings address', () => {
  it("is the workspace's hub for an instance admin", async () => {
    fakeApi({
      'GET /api/capabilities': caps(true),
      'GET /api/instance/workspaces': { body: { workspaces: [workspace()] } },
      'GET /api/workspaces/acme': {
        body: { canManage: true, isOwner: true, name: 'Acme', slug: 'acme', picture: null },
      },
      'GET /api/workspaces/acme/auth': { status: 404, body: { error: 'x' } },
      'GET /api/workspaces/acme/integrations': { status: 404, body: { error: 'x' } },
    })
    const { router } = await entry()
    await expect.element(page.getByRole('link', { name: /^General/ })).toBeVisible()
    expect(router.state.location.pathname).toBe('/workspaces/acme/settings')
  })

  it('redirects an owner or admin who is not an instance admin to General', async () => {
    fakeApi({ 'GET /api/capabilities': caps(false) })
    const { router } = await entry()
    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/workspaces/acme/settings/general')
  })
})
