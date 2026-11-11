import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { ProjectContextMenu } from '#features/projects/ProjectContextMenu.tsx'
import { ProjectsPage } from '#features/projects/ProjectsPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { overview as overviewOf, sidebarModel, sidebarProject } from '#test/support/fixtures.ts'
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
    'GET /api/projects': { body: { projects: [overviewOf('acme', 'web')] } },
    'GET /api/capabilities': { body: caps },
    'GET /api/workspaces/acme/sidebar': {
      body: sidebarModel({ canManage, projects: [sidebarProject({ slug: 'web', pinned: false })] }),
    },
    'PUT /api/workspaces/acme/pinned-projects/web': { body: { pinned: true, changed: true } },
    'DELETE /api/workspaces/acme/pinned-projects/web': { body: { pinned: false, changed: true } },
    'DELETE /api/projects/acme/web/members/u1': { status: 204 },
  })
  await renderPage(<ProjectsPage />, {
    route: '/',
    url: '/',
    announcer: true,
    otherRoutes: ['/$workspace/$project', '/$workspace/$project/settings'],
  })
  await expect.element(page.getByText('acme/web')).toBeVisible()
  // The menu reads the sidebar model: wait for it before right-clicking.
  await expect.poll(() => api.calls.some((c) => c.path.includes('/sidebar'))).toBe(true)
  return api
}

describe('a project row on the Projects page: right-click menu', () => {
  it("offers the project's pages as icons, then new tab, link, pin, settings and Leave project", async () => {
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
      'Pin project',
      'Project settings',
      'Leave project',
    ])
  })

  it('leaves the project after asking, with its own wording', async () => {
    const api = await show(false)
    await page.getByText('acme/web').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Leave project' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect.element(dialog).toHaveTextContent('Leave Web App?')
    expect(api.of('DELETE').filter((c) => c.path.includes('/members/'))).toHaveLength(0)
    await dialog.getByRole('button', { name: 'Leave project' }).click()
    await expect
      .poll(() => api.of('DELETE').filter((c) => c.path.endsWith('/members/u1')))
      .toHaveLength(1)
    await expect.element(toastNamed(/You left Web App/)).toBeVisible()
  })

  it('hides Project settings from someone who cannot manage', async () => {
    await show(false)
    await page.getByText('acme/web').click({ button: 'right' })
    await expect.element(page.getByRole('menuitem', { name: 'Pin project' })).toBeVisible()
    await expect
      .element(page.getByRole('menuitem', { name: 'Project settings' }))
      .not.toBeInTheDocument()
  })

  it("pins the project with the page button's mutation and offers Undo", async () => {
    const api = await show(false)
    await page.getByText('acme/web').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin project' }).click()
    await expect.poll(() => api.of('PUT')).toHaveLength(1)
    await expect.element(toastNamed(/Pinned project/)).toBeVisible()
    await toastNamed(/Pinned project/)
      .getByRole('button', { name: 'Undo' })
      .click()
    await expect.poll(() => api.of('DELETE')).toHaveLength(1)
  })

  it("shows Sites among the project's page icons only when it has some", async () => {
    fakeApi({
      'GET /api/workspaces/acme/sidebar': {
        body: sidebarModel({
          canManage: true,
          projects: [sidebarProject({ slug: 'web', pinned: true, siteCount: 1 })],
        }),
      },
    })
    await renderPage(
      <ProjectContextMenu workspace="acme" project="web">
        <a href="/acme/web">Web</a>
      </ProjectContextMenu>,
      { otherRoutes: ['/$workspace/$project'] },
    )
    await expect.element(page.getByText('Web')).toBeVisible()
    await expect
      .poll(async () => {
        await page.getByText('Web').click({ button: 'right' })
        return itemNames()
      })
      .toContain('Unpin project')
    expect(itemNames()).toEqual([
      'Builds',
      'Triage',
      'Baselines',
      'Sites',
      'Open in new tab',
      'Copy link',
      'Unpin project',
      'Project settings',
      'Leave project',
    ])
  })
})
