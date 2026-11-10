import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { WorkspacesPage } from '#features/instance/WorkspacesPage.tsx'
import { useWorkspaceStore } from '#lib/stores/workspace-store.ts'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

import { settingsFixture, workspace } from './fixtures.ts'

const text = (name: string) =>
  page.getByRole('listitem').filter({ hasText: name }).element().textContent

const left = (el: Element) => Math.round(el.getBoundingClientRect().left)

const show = () => renderPage(<WorkspacesPage />, { route: '/instance/workspaces' })

const LIST = {
  'GET /api/instance/workspaces': {
    body: {
      workspaces: [
        workspace(),
        workspace({
          id: 'w2',
          name: 'Design Guild',
          slug: 'design-guild',
          teamCount: 0,
          memberCount: 1,
          storageBytes: 0,
        }),
      ],
    },
  },
  'GET /api/instance/settings': { body: settingsFixture() },
}

const table = () => document.querySelector<HTMLElement>('[class*="table"]')!
const overlaps = (a: Element, b: Element) => {
  const x = a.getBoundingClientRect()
  const y = b.getBoundingClientRect()
  return x.left < y.right && y.left < x.right
}

describe('the workspaces page', () => {
  it('lists workspaces with members, teams and storage', async () => {
    fakeApi(LIST)
    await show()
    await expect.element(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible()
    await expect.element(page.getByText(/1\.5 MB/)).toBeVisible()
    expect(text('acme')).toMatch(/Members 6\s*Teams 3\s*Created Sep 12/)
    expect(text('design-guild')).toMatch(/Members 1\s*Teams 0/)
    await expect.element(page.getByText('Instance admins only')).toBeVisible()
    await expect.element(page.getByText(/Set WORKSPACE_CREATION=anyone/)).toBeVisible()
  })

  it('keeps each row on one line with its columns under their headers', async () => {
    await page.viewport(1000, 800)
    fakeApi(LIST)
    await show()
    await expect.element(page.getByRole('listitem').filter({ hasText: 'acme' })).toBeVisible()
    const header = (name: string) =>
      left(
        [...document.querySelectorAll('[aria-hidden="true"] > span')].find(
          (e) => e.textContent === name,
        )!,
      )
    const row = page.getByRole('listitem').filter({ hasText: 'acme' }).element()
    const cells = row.querySelectorAll(':scope > span')
    // tile, name, Members, Teams, Created, action
    expect(left(cells[2]!)).toBe(header('Members'))
    expect(left(cells[3]!)).toBe(header('Teams'))
    expect(left(cells[4]!)).toBe(header('Created'))
    // One line: the date does not wrap ("Sep 12", with the year only for another year).
    const created = cells[4]!.getBoundingClientRect()
    expect(created.height).toBeLessThan(24)
    expect(row.getBoundingClientRect().height).toBeLessThan(80)
  })

  it('marks a deleted workspace with its days left, and restores it', async () => {
    let deleted = true
    const fake = fakeApi({
      'GET /api/instance/workspaces': () => ({
        body: {
          workspaces: [
            workspace({
              id: 'w9',
              name: 'Old Co',
              slug: 'old-co',
              ...(deleted ? { deletedAt: '2026-11-01T00:00:00.000Z', daysLeft: 22 } : {}),
            }),
          ],
        },
      }),
      'GET /api/instance/settings': { body: settingsFixture() },
      'POST /api/instance/workspaces/w9/restore': () => {
        deleted = false
        return { body: { workspace: workspace({ id: 'w9' }) } }
      },
    })
    await show()
    await expect.element(page.getByText('Deleted · 22 days left')).toBeVisible()
    await page.getByRole('button', { name: 'Actions for Old Co' }).click()
    await page.getByRole('menuitem', { name: 'Restore' }).click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    await expect.element(page.getByText('Deleted · 22 days left')).not.toBeInTheDocument()
    await expect.element(page.getByText('Restored the workspace Old Co.')).toBeVisible()
  })

  it('purges a deleted workspace at once after its address is typed', async () => {
    const fake = fakeApi({
      'GET /api/instance/workspaces': {
        body: {
          workspaces: [
            workspace({
              id: 'w9',
              name: 'Old Co',
              slug: 'old-co',
              deletedAt: '2026-11-01T00:00:00.000Z',
              daysLeft: 1,
            }),
          ],
        },
      },
      'GET /api/instance/settings': { body: settingsFixture() },
      'POST /api/instance/workspaces/w9/purge': { status: 204 },
    })
    await show()
    await expect.element(page.getByText('Deleted · 1 day left')).toBeVisible()
    await page.getByRole('button', { name: 'Actions for Old Co' }).click()
    await page.getByRole('menuitem', { name: 'Delete permanently now' }).click()
    const confirm = page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete permanently' })
    await expect.element(confirm).toBeDisabled()
    await page.getByRole('alertdialog').getByRole('textbox').fill('old-co')
    await confirm.click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
  })

  describe('with a deleted workspace', () => {
    const DELETED = {
      'GET /api/instance/workspaces': {
        body: {
          workspaces: [
            workspace(),
            workspace({
              id: 'w9',
              name: 'Delta Research Laboratories',
              slug: 'delta-research-laboratories',
              deletedAt: '2026-11-01T00:00:00.000Z',
              daysLeft: 22,
            }),
          ],
        },
      },
      'GET /api/instance/settings': { body: settingsFixture() },
    }
    it("shows a deleted row's name and status in full at a wide container", async () => {
      await page.viewport(1440, 900)
      fakeApi(DELETED)
      await show()
      const status = page.getByText('Deleted · 22 days left')
      await expect.element(status).toBeVisible()
      const name = page.getByText('Delta Research Laboratories').element()
      expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth)
      const badge = status.element()
      expect(badge.scrollWidth).toBeLessThanOrEqual(badge.clientWidth)
      // The tile has a gap before the name.
      const row = page.getByRole('listitem').filter({ hasText: 'Delta Research' }).element()
      const [tile, nameCell] = row.querySelectorAll(':scope > span')
      expect(nameCell!.getBoundingClientRect().left - tile!.getBoundingClientRect().right).toBe(12)
    })

    it('keeps the name readable and the box intact in a narrow container', async () => {
      await page.viewport(1440, 900)
      fakeApi(DELETED)
      await show()
      await expect.element(page.getByText('Deleted · 22 days left')).toBeVisible()
      table().style.width = '520px'
      const box = table().firstElementChild!
      expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth)
      const row = page.getByRole('listitem').filter({ hasText: 'Delta Research' }).element()
      const nameCell = row.querySelectorAll(':scope > span')[1]!
      expect(nameCell.getBoundingClientRect().width).toBeGreaterThanOrEqual(160)
      const heads = [...box.querySelectorAll<HTMLElement>('[aria-hidden="true"] > span')].filter(
        (e) => e.textContent && getComputedStyle(e).display !== 'none',
      )
      expect(heads.map((e) => e.textContent)).toEqual(['Workspace', 'Members', 'Teams'])
      for (let i = 1; i < heads.length; i++) expect(overlaps(heads[i - 1]!, heads[i]!)).toBe(false)
      // Created is hidden in a container this narrow, and the status is still whole.
      expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth)
      const badge = page.getByText('Deleted · 22 days left').element()
      expect(badge.scrollWidth).toBeLessThanOrEqual(badge.clientWidth)
    })

    it("offers Restore and Delete permanently now in the row's menu", async () => {
      fakeApi(DELETED)
      await show()
      await page.getByRole('button', { name: 'Actions for Delta Research Laboratories' }).click()
      await expect.element(page.getByRole('menuitem', { name: 'Restore' })).toBeVisible()
      await expect
        .element(page.getByRole('menuitem', { name: 'Delete permanently now' }))
        .toBeVisible()
    })
  })

  it('says so to someone who is not an instance admin', async () => {
    fakeApi({ 'GET /api/instance/workspaces': { status: 403, body: { error: 'Forbidden' } } })
    await show()
    await expect.element(page.getByRole('heading', { name: 'Instance admins only' })).toBeVisible()
  })

  it('shows an empty state', async () => {
    fakeApi({ 'GET /api/instance/workspaces': { body: { workspaces: [] } } })
    await show()
    await expect.element(page.getByRole('heading', { name: 'No workspaces yet' })).toBeVisible()
  })

  it('creates a workspace for an owner, showing the address it gets', async () => {
    const fake = fakeApi({
      ...LIST,
      'POST /api/instance/workspaces': {
        status: 201,
        body: { workspace: workspace({ id: 'w3', name: 'Acme Mobile', slug: 'acme-mobile' }) },
      },
    })
    await show()
    await page.getByRole('button', { name: 'Create workspace' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Acme Mobile')
    await expect.element(page.getByText('Address: acme-mobile')).toBeVisible()
    await page.getByRole('textbox', { name: "Owner's email" }).fill('dana@acme.dev')
    await page.getByRole('dialog').getByRole('button', { name: 'Create workspace' }).click()
    await expect.element(page.getByText('Created the workspace Acme Mobile.')).toBeVisible()
    expect(fake.of('POST')[0]?.body).toEqual({ name: 'Acme Mobile', ownerEmail: 'dana@acme.dev' })
  })

  it("checks the fields, and shows the server's refusal", async () => {
    const fake = fakeApi({
      ...LIST,
      'POST /api/instance/workspaces': {
        status: 404,
        body: { error: 'No account has that email' },
      },
    })
    await show()
    await page.getByRole('button', { name: 'Create workspace' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Create workspace' }).click()
    await expect.element(page.getByText('Enter a name')).toBeVisible()
    expect(fake.of('POST')).toHaveLength(0)
    await page.getByRole('textbox', { name: 'Name' }).fill('Acme Mobile')
    await page.getByRole('textbox', { name: "Owner's email" }).fill('nobody@acme.dev')
    await page.getByRole('dialog').getByRole('button', { name: 'Create workspace' }).click()
    await expect.element(page.getByText('No account has that email')).toBeVisible()
  })
})

describe('opening a workspace', () => {
  const OPEN = {
    'GET /api/instance/workspaces': {
      body: {
        workspaces: [
          workspace(),
          workspace({
            id: 'w2',
            name: 'Design Guild',
            slug: 'design-guild',
            ownerName: 'Dana Levi',
            youAreMember: false,
          }),
          workspace({
            id: 'w3',
            name: 'Old Co',
            slug: 'old-co',
            deletedAt: '2026-11-01T10:00:00.000Z',
            daysLeft: 22,
            youAreMember: false,
          }),
        ],
      },
    },
    'GET /api/instance/settings': { body: settingsFixture() },
  }

  it('chooses the workspace you belong to and lands on the Teams page', async () => {
    fakeApi(OPEN)
    const { router } = await renderPage(<WorkspacesPage />, {
      route: '/instance/workspaces',
      otherRoutes: ['/'],
    })
    await page.getByRole('link', { name: 'Open Acme' }).click()
    expect(router.state.location.pathname).toBe('/')
    expect(useWorkspaceStore.getState().chosen).toBe('acme')
  })

  it('shows Not a member, without a link, for a live workspace you are not in', async () => {
    fakeApi(OPEN)
    await show()
    const row = page.getByRole('listitem').filter({ hasText: 'Design Guild' })
    await expect.element(row.getByText('Not a member')).toBeVisible()
    expect(row.getByRole('link').elements()).toHaveLength(0)
    expect(text('Design Guild')).toMatch(/Owner Dana Levi/)
  })

  it('keeps the menu, and no Open or Not a member, on a deleted workspace', async () => {
    fakeApi(OPEN)
    await show()
    const row = page.getByRole('listitem').filter({ hasText: 'Old Co' })
    await expect.element(row.getByRole('button', { name: 'Actions for Old Co' })).toBeVisible()
    expect(row.getByRole('link').elements()).toHaveLength(0)
    expect(row.getByText('Not a member').elements()).toHaveLength(0)
  })
})
