import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it.
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { ProjectMembersPage } from '#features/project-settings/ProjectMembersPage.tsx'
import { mockAuthClient } from '#test/support/auth-client.ts'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { overview } from '#test/support/fixtures.ts'
import { pageHeader } from '#test/support/header.ts'
import { renderPage } from '#test/support/render.tsx'

const API = '/api/projects/acme/web'

const member = (id: string, name: string, role = 'member') => ({
  id,
  name,
  email: `${name.split(' ')[0]?.toLowerCase()}@acme.test`,
  image: null,
  role,
  addedAt: '2026-11-01T00:00:00.000Z',
})

const ADA = member('u1', 'Ada Lovelace', 'owner')
const GRACE = member('u2', 'Grace Hopper', 'admin')
const ALAN = member('u3', 'Alan Turing')

const workspaceMember = (m: ReturnType<typeof member>) => ({
  id: `m-${m.id}`,
  userId: m.id,
  role: m.role,
  user: { id: m.id, name: m.name, email: m.email, image: null },
})

const settings = (canManage: boolean) => ({
  canManage,
  settings: { name: 'Web App', slug: 'web' },
  appearance: { color: 'slate', icon: null },
  workspace: { flakyBlocksMerge: true },
  webhooks: [],
  webhookEvents: [],
  github: { configured: false, webhookUrl: '', link: null },
  sitesConfigured: false,
})

const auth = mockAuthClient().organization

beforeEach(() => {
  auth.getFullOrganization.mockResolvedValue({
    data: {
      id: 'ws1',
      name: 'Acme',
      slug: 'acme',
      members: [ADA, GRACE, ALAN, member('u4', 'Omer Katz'), member('u5', 'Noa Ben-Ari')].map(
        workspaceMember,
      ),
      invitations: [],
    },
    error: null,
  })
})

function show(options: { canManage?: boolean; members?: ReturnType<typeof member>[] } = {}) {
  const canManage = options.canManage ?? true
  return renderPage(<ProjectMembersPage />, {
    route: '/$workspace/$project/settings/members',
    url: '/acme/web/settings/members',
    announcer: true,
    otherRoutes: [
      '/$workspace/$project',
      '/$workspace/$project/sites',
      '/$workspace/$project/settings',
      '/$workspace/$project/settings/token',
      '/$workspace/$project/settings/reviews',
      '/$workspace/$project/settings/webhooks',
      '/$workspace/$project/settings/ignore-regions',
      '/workspaces/$workspace/settings/projects',
    ],
    api: {
      [`GET ${API}/settings`]: { body: settings(canManage) },
      'GET /api/projects': { body: { projects: [overview('acme', 'web')] } },
      [`GET ${API}/members`]: {
        body: { members: options.members ?? [ADA, GRACE, ALAN], canManage },
      },
      [`POST ${API}/members`]: { body: { members: [ADA, GRACE, ALAN], canManage } },
      [`DELETE ${API}/members/u3`]: { status: 204 },
      [`DELETE ${API}/members/u1`]: { status: 204 },
    },
  })
}

describe('a project settings page: way back, title and breadcrumb', () => {
  it('has a back link to the project hub, its own title and no tab strip', async () => {
    await show()
    await expect
      .element(page.getByRole('link', { name: 'Web App' }).last())
      .toHaveAttribute('href', '/acme/web/settings')
    await expect.element(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible()
    expect(page.getByRole('navigation', { name: 'Web App settings' }).elements()).toHaveLength(0)
    expect(page.getByRole('link', { name: 'CI token' }).elements()).toHaveLength(0)
  })

  it('names the project in the breadcrumb: workspace, Settings, Projects, the project (to its hub), the page', async () => {
    await show()
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect
      .element(crumbs.getByRole('link', { name: 'Projects' }))
      .toHaveAttribute('href', '/workspaces/acme/settings/projects')
    await expect
      .element(crumbs.getByRole('link', { name: 'Web App' }))
      .toHaveAttribute('href', '/acme/web/settings')
    await expect.element(crumbs.getByText('Members')).toBeVisible()
  })

  it('shows people who only belong to the project the same page, without the manager pages in the way', async () => {
    await show({ canManage: false })
    await expect.element(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible()
    expect(page.getByRole('button', { name: 'Add members' }).elements()).toHaveLength(0)
  })
})

describe('a project Members page', () => {
  it("lists each person's name, email and workspace role", async () => {
    await show()
    const list = page.getByRole('list', { name: 'Project members' })
    await expect.element(list.getByText('Grace Hopper')).toBeVisible()
    expect(list.getByRole('listitem').elements()).toHaveLength(3)
    await expect.element(list.getByText('grace@acme.test')).toBeVisible()
    await expect.element(list.getByText('Owner')).toBeVisible()
    await expect.element(list.getByText('Admin')).toBeVisible()
    await expect.element(list.getByText('· you')).toBeVisible()
  })

  it('puts Add members and the find field in the page header', async () => {
    await page.viewport(1280, 800)
    await show()
    await expect.element(page.getByRole('list', { name: 'Project members' })).toBeVisible()
    const header = pageHeader()
    expect(header.contains(page.getByRole('button', { name: 'Add members' }).element())).toBe(true)
    expect(header.contains(page.getByRole('textbox', { name: 'Find members' }).element())).toBe(
      true,
    )
  })

  it('adds workspace members who are not in the project, then posts their IDs', async () => {
    const { calls } = await show()
    await page.getByRole('button', { name: 'Add members' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add members to Web App' })
    await expect.element(dialog).toBeVisible()
    // Only the two who aren't in the project are offered, and nobody is picked yet.
    await expect.element(dialog.getByRole('checkbox', { name: /Omer Katz/ })).toBeVisible()
    expect(dialog.getByRole('checkbox').elements()).toHaveLength(2)
    await expect.element(dialog.getByRole('button', { name: 'Add 0 members' })).toBeDisabled()

    await userEvent.type(dialog.getByRole('textbox', { name: 'Find a workspace member' }), 'noa')
    await expect.poll(() => dialog.getByRole('checkbox').elements()).toHaveLength(1)
    await dialog.getByRole('checkbox', { name: /Noa Ben-Ari/ }).click()
    await dialog.getByRole('button', { name: 'Add 1 member' }).click()

    await expect.poll(() => calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: `${API}/members`,
      body: { userIds: ['u5'] },
    })
    await expect.element(dialog).not.toBeInTheDocument()
  })

  it('confirms before removing someone, and only then deletes', async () => {
    const { calls } = await show()
    await page.getByRole('button', { name: 'Remove Alan Turing from project' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Remove Alan Turing from Web App?' })
    await expect.element(dialog).toBeVisible()
    await expect
      .element(dialog)
      .toMatchTextContent(/They will stop getting Web App's review requests and mentions/)
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)

    await dialog.getByRole('button', { name: 'Remove' }).click()
    await expect.poll(() => calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
    expect(calls.find((c) => c.method === 'DELETE')?.path).toBe(`${API}/members/u3`)
  })

  it('leaves the project with your own ID, after a confirmation that says what changes', async () => {
    const { calls, router } = await show()
    await page.getByRole('button', { name: 'Leave project' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Leave Web App?' })
    await expect.element(dialog).toMatchTextContent(/An owner or admin can add you back\./)
    await dialog.getByRole('button', { name: 'Leave project' }).click()
    await expect.poll(() => calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
    expect(calls.find((c) => c.method === 'DELETE')?.path).toBe(`${API}/members/u1`)
    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/workspaces/acme/settings/projects')
  })

  it('shows plain members the list and Leave only: no Add and no Remove', async () => {
    await show({ canManage: false, members: [ADA, member('u1b', 'Ada Two'), GRACE] })
    await expect.element(page.getByRole('list', { name: 'Project members' })).toBeVisible()
    expect(page.getByRole('button', { name: 'Add members' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: /^Remove / }).elements()).toHaveLength(0)
    await expect.element(page.getByRole('button', { name: 'Leave project' })).toBeVisible()
    expect(page.getByRole('button', { name: 'Leave project' }).elements()).toHaveLength(1)
  })
})

describe('the Members find field', () => {
  it('finds members by name, email or role, keeps the text in the address and clears it with Esc', async () => {
    const { router } = await show()
    const list = page.getByRole('list', { name: 'Project members' })
    const find = page.getByRole('textbox', { name: 'Find members' })
    await expect.element(find).toHaveAttribute('placeholder', 'Find members')
    await expect.element(list.getByText('Ada Lovelace')).toBeVisible()
    await userEvent.keyboard('/')
    await expect.element(find).toHaveFocus()
    await userEvent.type(find, 'turing')
    await expect.element(list.getByText('Alan Turing')).toBeVisible()
    await expect.element(list.getByText('Ada Lovelace')).not.toBeInTheDocument()
    await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'turing' }))
    await userEvent.fill(find, 'admin')
    await expect.element(list.getByText('Grace Hopper')).toBeVisible()
    await userEvent.fill(find, 'zzz')
    await expectEmptyState('No member matches “zzz”', { action: 'Clear search' })
    await userEvent.keyboard('{Escape}')
    await expect.element(find).toHaveValue('')
    await expect.element(list.getByText('Ada Lovelace')).toBeVisible()
    await vi.waitFor(() => expect(router.state.location.search).not.toHaveProperty('q'))
  })
})
