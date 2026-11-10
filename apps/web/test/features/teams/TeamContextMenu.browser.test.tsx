import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { TeamContextMenu } from '#features/teams/TeamContextMenu.tsx'
import { TeamsPage } from '#features/teams/TeamsPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { overview as overviewOf, sidebarModel, sidebarTeam } from '#test/support/fixtures.ts'
import { renderPage } from '#test/support/render.tsx'
import { toastNamed } from '#test/support/toast.ts'

const caps = {
  canCreateWorkspace: false,
  instanceAdmin: false,
  manageableWorkspaces: [],
  refusingWorkspaces: [],
}

async function show(canManage: boolean) {
  const api = fakeApi({
    'GET /api/teams': { body: { teams: [overviewOf('acme', 'web')] } },
    'GET /api/capabilities': { body: caps },
    'GET /api/workspaces/acme/sidebar': {
      body: sidebarModel({ canManage, teams: [sidebarTeam({ slug: 'web', pinned: false })] }),
    },
    'PUT /api/workspaces/acme/pinned-teams/web': { body: { pinned: true, changed: true } },
    'DELETE /api/workspaces/acme/pinned-teams/web': { body: { pinned: false, changed: true } },
  })
  await renderPage(<TeamsPage />, {
    route: '/',
    url: '/',
    announcer: true,
    otherRoutes: ['/$workspace/$team', '/$workspace/$team/settings'],
  })
  await expect.element(page.getByText('acme/web')).toBeVisible()
  // The menu reads the sidebar model: wait for it before right-clicking.
  await expect.poll(() => api.calls.some((c) => c.path.includes('/sidebar'))).toBe(true)
  return api
}

describe('a team row on the Teams page: right-click menu', () => {
  it('offers Open, Open in new tab, Copy link, Pin team and Team settings to someone who manages', async () => {
    await show(true)
    await page.getByText('acme/web').click({ button: 'right' })
    await expect.element(page.getByRole('menu')).toBeVisible()
    const names = page
      .getByRole('menuitem')
      .elements()
      .map((el) => el.textContent)
    expect(names).toEqual(['Open', 'Open in new tab', 'Copy link', 'Pin team', 'Team settings'])
  })

  it('hides Team settings from someone who cannot manage', async () => {
    await show(false)
    await page.getByText('acme/web').click({ button: 'right' })
    await expect.element(page.getByRole('menuitem', { name: 'Pin team' })).toBeVisible()
    await expect
      .element(page.getByRole('menuitem', { name: 'Team settings' }))
      .not.toBeInTheDocument()
  })

  it("pins the team with the page button's mutation and offers Undo", async () => {
    const api = await show(false)
    await page.getByText('acme/web').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin team' }).click()
    await expect.poll(() => api.of('PUT')).toHaveLength(1)
    await expect.element(toastNamed(/Pinned team/)).toBeVisible()
    await toastNamed(/Pinned team/)
      .getByRole('button', { name: 'Undo' })
      .click()
    await expect.poll(() => api.of('DELETE')).toHaveLength(1)
  })

  it("offers the team's pages from its sidebar entry, and Sites only when it has some", async () => {
    fakeApi({
      'GET /api/workspaces/acme/sidebar': {
        body: sidebarModel({
          canManage: true,
          teams: [sidebarTeam({ slug: 'web', pinned: true, siteCount: 1 })],
        }),
      },
    })
    await renderPage(
      <TeamContextMenu workspace="acme" team="web" pages>
        <a href="/acme/web">Web</a>
      </TeamContextMenu>,
      { otherRoutes: ['/$workspace/$team'] },
    )
    await expect.element(page.getByText('Web')).toBeVisible()
    await expect
      .poll(async () => {
        await page.getByText('Web').click({ button: 'right' })
        return page
          .getByRole('menuitem')
          .elements()
          .map((el) => el.textContent)
      })
      .toContain('Unpin team')
    expect(
      page
        .getByRole('menuitem')
        .elements()
        .map((el) => el.textContent),
    ).toEqual([
      'Open builds',
      'Open triage',
      'Open baselines',
      'Open sites',
      'Open in new tab',
      'Copy link',
      'Unpin team',
      'Team settings',
    ])
  })
})
