import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { TeamContextMenu } from '#features/teams/TeamContextMenu.tsx'
import { TeamsPage } from '#features/teams/TeamsPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { overview as overviewOf, sidebarModel, sidebarTeam } from '#test/support/fixtures.ts'
import { renderPage } from '#test/support/render.tsx'
import { toastNamed } from '#test/support/toast.ts'

/** The menu's items by name: the page icons are named by their label, the rest by their text. */
const itemNames = () =>
  page
    .getByRole('menuitem')
    .elements()
    .map((el) => el.getAttribute('aria-label') ?? el.textContent)

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
    'DELETE /api/teams/acme/web/members/u1': { status: 204 },
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
  it("offers the team's pages as icons, then new tab, link, pin, settings and Leave team", async () => {
    await show(true)
    await page.getByText('acme/web').click({ button: 'right' })
    await expect.element(page.getByRole('menu')).toBeVisible()
    await expect.element(page.getByRole('group', { name: /pages$/ })).toBeVisible()
    expect(itemNames()).toEqual([
      'Builds',
      'Triage',
      'Baselines',
      'Open in new tab',
      'Copy link',
      'Pin team',
      'Team settings',
      'Leave team',
    ])
  })

  it('leaves the team after asking, with its own wording', async () => {
    const api = await show(false)
    await page.getByText('acme/web').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Leave team' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect.element(dialog).toHaveTextContent('Leave Web App?')
    expect(api.of('DELETE').filter((c) => c.path.includes('/members/'))).toHaveLength(0)
    await dialog.getByRole('button', { name: 'Leave team' }).click()
    await expect
      .poll(() => api.of('DELETE').filter((c) => c.path.endsWith('/members/u1')))
      .toHaveLength(1)
    await expect.element(toastNamed(/You left Web App/)).toBeVisible()
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

  it("shows Sites among the team's page icons only when it has some", async () => {
    fakeApi({
      'GET /api/workspaces/acme/sidebar': {
        body: sidebarModel({
          canManage: true,
          teams: [sidebarTeam({ slug: 'web', pinned: true, siteCount: 1 })],
        }),
      },
    })
    await renderPage(
      <TeamContextMenu workspace="acme" team="web">
        <a href="/acme/web">Web</a>
      </TeamContextMenu>,
      { otherRoutes: ['/$workspace/$team'] },
    )
    await expect.element(page.getByText('Web')).toBeVisible()
    await expect
      .poll(async () => {
        await page.getByText('Web').click({ button: 'right' })
        return itemNames()
      })
      .toContain('Unpin team')
    expect(itemNames()).toEqual([
      'Builds',
      'Triage',
      'Baselines',
      'Sites',
      'Open in new tab',
      'Copy link',
      'Unpin team',
      'Team settings',
      'Leave team',
    ])
  })
})
