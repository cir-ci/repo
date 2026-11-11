import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { WorkspaceBackLink } from '#features/workspace-settings/WorkspaceBackLink.tsx'
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
      '/workspaces/$workspace/settings/teams',
      '/instance/settings',
    ],
  })

const link = () =>
  renderPage(<WorkspaceBackLink workspace="acme" name="Acme Inc" />, {
    route: '/workspaces/$workspace/settings/members',
    url: '/workspaces/acme/settings/members',
    otherRoutes: ['/workspaces/$workspace/settings'],
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

describe('the back link on a workspace settings page', () => {
  it("goes to the workspace's hub, named for the workspace, for an instance admin", async () => {
    fakeApi({ 'GET /api/capabilities': caps(true) })
    const { router } = await link()
    const back = page.getByRole('link', { name: 'Acme Inc' })
    await expect.element(back).toHaveAttribute('href', '/workspaces/acme/settings')
    await back.click()
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/acme/settings')
  })

  it('is not there for everyone else, who have the sidebar and no hub', async () => {
    fakeApi({ 'GET /api/capabilities': caps(false) })
    await link()
    await expect.poll(() => page.getByRole('link').elements().length).toBe(0)
  })
})
