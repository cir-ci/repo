import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { TeamDialogs } from '#features/teams/TeamDialogs.tsx'
import { TeamsPage } from '#features/teams/TeamsPage.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { fakeApi } from '#test/support/fetch.ts'
import { overview } from '#test/support/fixtures.ts'
import { renderPage } from '#test/support/render.tsx'

const caps = (manageable = true) => ({
  body: {
    canCreateWorkspace: false,
    instanceAdmin: false,
    manageableWorkspaces: manageable
      ? [{ slug: 'acme', name: 'ACME', picture: null, role: 'owner' }]
      : [],
    refusingWorkspaces: [],
  },
})
const integrations = (kinds: string[]) => ({
  body: {
    canManage: true,
    catalog: [],
    integrations: kinds.map((kind, i) => ({ id: `i${i}`, kind, group: 'git', name: kind })),
  },
})
const REPOS = {
  repositories: [
    { integration: 'i0', installation: 'Installation 42', ref: 'acme/web-app', private: true },
    { integration: 'i0', installation: 'Installation 42', ref: 'acme/docs', private: false },
    { integration: 'i0', installation: 'Installation 42', ref: 'acme/api', private: false },
  ],
}

const show = () =>
  renderPage(
    <>
      <TeamsPage />
      <TeamDialogs />
    </>,
    { route: '/', url: '/', announcer: true },
  )

describe('Import from GitHub', () => {
  it('is a button beside New team (with its plus) when a GitHub App is installed', async () => {
    fakeApi({
      'GET /api/teams': { body: { teams: [overview('acme', 'web')] } },
      'GET /api/capabilities': caps(),
      'GET /api/workspaces/acme/integrations': integrations(['github']),
    })
    await show()
    await expect.element(page.getByRole('button', { name: 'Import from GitHub' })).toBeVisible()
    const create = page.getByRole('button', { name: 'New team' })
    await expect.element(create).toBeVisible()
    expect(create.element().querySelector('svg')).not.toBeNull()
  })

  it("isn't shown without an installation, or to people who can't manage the workspace", async () => {
    fakeApi({
      'GET /api/teams': { body: { teams: [overview('acme', 'web')] } },
      'GET /api/capabilities': caps(),
      'GET /api/workspaces/acme/integrations': integrations(['slack']),
    })
    await show()
    await expect.element(page.getByRole('button', { name: 'New team' })).toBeVisible()
    expect(page.getByRole('button', { name: 'Import from GitHub' }).elements()).toHaveLength(0)
  })

  it('searches the unlinked repositories, imports the ticked ones and closes', async () => {
    const api = fakeApi({
      'GET /api/teams': { body: { teams: [overview('acme', 'web')] } },
      'GET /api/capabilities': caps(),
      'GET /api/workspaces/acme/integrations': integrations(['github']),
      'GET /api/workspaces/acme/github-import': { body: REPOS },
      'POST /api/workspaces/acme/github-import': {
        body: { teams: [{ slug: 'web-app', name: 'web-app', repository: 'acme/web-app' }] },
      },
    })
    await show()
    await page.getByRole('button', { name: 'Import from GitHub' }).click()
    const dialog = page.getByRole('dialog', { name: 'Import from GitHub' })
    await expect.element(dialog.getByRole('checkbox', { name: /acme\/docs/ })).toBeVisible()
    expect(dialog.getByRole('checkbox').elements()).toHaveLength(3)
    // Nothing is picked: the button says only "Import" and can't be used.
    await expect.element(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled()

    await userEvent.type(dialog.getByRole('textbox', { name: 'Find a repository' }), 'web')
    expect(dialog.getByRole('checkbox').elements()).toHaveLength(1)
    await dialog.getByRole('checkbox', { name: /acme\/web-app/ }).click()
    await dialog.getByRole('button', { name: 'Import 1 team' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(api.of('POST')[0]?.body).toEqual({
      repositories: [{ integration: 'i0', ref: 'acme/web-app' }],
    })
  })

  it('is in each workspace group when there are several, and imports into that workspace', async () => {
    const api = fakeApi({
      'GET /api/teams': {
        body: { teams: [overview('acme', 'web'), overview('globex', 'portal')] },
      },
      'GET /api/capabilities': {
        body: {
          canCreateWorkspace: false,
          instanceAdmin: false,
          manageableWorkspaces: [
            { slug: 'acme', name: 'ACME', picture: null, role: 'owner' },
            { slug: 'globex', name: 'GLOBEX', picture: null, role: 'owner' },
          ],
          refusingWorkspaces: [],
        },
      },
      'GET /api/workspaces/acme/integrations': integrations(['slack']),
      'GET /api/workspaces/globex/integrations': integrations(['github']),
      'GET /api/workspaces/globex/github-import': { body: REPOS },
    })
    await show()
    // Only Globex has a GitHub App: one Import button, inside Globex's group, not in the page header.
    const globex = page.getByRole('region', { name: /^GLOBEX/ })
    await expect.element(globex.getByRole('button', { name: 'Import from GitHub' })).toBeVisible()
    expect(page.getByRole('button', { name: 'Import from GitHub' }).elements()).toHaveLength(1)
    expect(
      page
        .getByRole('region', { name: /^ACME/ })
        .getByRole('button', { name: 'Import from GitHub' })
        .elements(),
    ).toHaveLength(0)
    await globex.getByRole('button', { name: 'Import from GitHub' }).click()
    await expect.element(page.getByRole('dialog', { name: 'Import from GitHub' })).toBeVisible()
    await expect
      .poll(() => api.of('GET').some((r) => r.path === '/api/workspaces/globex/github-import'))
      .toBe(true)
  })

  it('says why when GitHub does not answer', async () => {
    fakeApi({
      'GET /api/teams': { body: { teams: [overview('acme', 'web')] } },
      'GET /api/capabilities': caps(),
      'GET /api/workspaces/acme/integrations': integrations(['github']),
      'GET /api/workspaces/acme/github-import': {
        status: 502,
        body: { error: "GitHub didn't answer; try again shortly" },
      },
    })
    await show()
    useOverlayStore.getState().setImportWorkspace('acme')
    await expect
      .element(page.getByRole('dialog').getByText("GitHub didn't answer; try again shortly"))
      .toBeVisible()
  })
})
