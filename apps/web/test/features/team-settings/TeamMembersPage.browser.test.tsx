import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it.
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { TeamMembersPage } from '#features/team-settings/TeamMembersPage.tsx'
import { mockAuthClient } from '#test/support/auth-client.ts'
import { overview } from '#test/support/fixtures.ts'
import { renderPage } from '#test/support/render.tsx'

const API = '/api/teams/acme/web'

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
  return renderPage(<TeamMembersPage />, {
    route: '/$workspace/$team/settings/members',
    url: '/acme/web/settings/members',
    announcer: true,
    otherRoutes: [
      '/$workspace/$team',
      '/$workspace/$team/sites',
      '/$workspace/$team/settings',
      '/$workspace/$team/settings/token',
      '/$workspace/$team/settings/reviews',
      '/$workspace/$team/settings/webhooks',
      '/$workspace/$team/settings/ignore-regions',
      '/workspaces/$workspace/settings/teams',
    ],
    api: {
      [`GET ${API}/settings`]: { body: settings(canManage) },
      'GET /api/teams': { body: { teams: [overview('acme', 'web')] } },
      [`GET ${API}/members`]: {
        body: { members: options.members ?? [ADA, GRACE, ALAN], canManage },
      },
      [`POST ${API}/members`]: { body: { members: [ADA, GRACE, ALAN], canManage } },
      [`DELETE ${API}/members/u3`]: { status: 204 },
      [`DELETE ${API}/members/u1`]: { status: 204 },
    },
  })
}

const tabs = () =>
  page
    .getByRole('navigation', { name: 'Web App settings' })
    .getByRole('link')
    .elements()
    .map((el) => el.textContent)

describe('a team settings page: header and tabs', () => {
  it('shows the team header with a way back, the member count and every tab', async () => {
    await show()
    await expect.element(page.getByRole('link', { name: 'Teams' }).last()).toBeVisible()
    await expect
      .element(page.getByRole('link', { name: 'Teams' }).last())
      .toHaveAttribute('href', '/workspaces/acme/settings/teams')
    await expect.element(page.getByText('3 members').first()).toBeVisible()
    expect(tabs()).toEqual([
      'General',
      'Members',
      'CI token',
      'Reviews and triage',
      'Webhooks',
      'Ignore regions',
      'Sites',
    ])
    await expect
      .element(page.getByRole('link', { name: 'Members', exact: true }))
      .toHaveAttribute('aria-current', 'page')
    await expect
      .element(page.getByRole('link', { name: 'Sites' }))
      .toHaveAttribute('href', '/acme/web/sites')
  })

  it('names the team in the breadcrumb: workspace, Settings, Teams, the team', async () => {
    await show()
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect.element(crumbs.getByRole('link', { name: 'Teams' })).toBeVisible()
    await expect.element(crumbs.getByText('Web App')).toBeVisible()
  })

  it('gives people who only belong to the team the Members and Ignore regions tabs', async () => {
    await show({ canManage: false })
    await expect.element(page.getByRole('navigation', { name: 'Web App settings' })).toBeVisible()
    expect(tabs()).toEqual(['Members', 'Ignore regions'])
  })
})

describe('a team Members tab', () => {
  it("lists each person's name, email and workspace role", async () => {
    await show()
    const list = page.getByRole('list', { name: 'Team members' })
    await expect.element(list.getByText('Grace Hopper')).toBeVisible()
    expect(list.getByRole('listitem').elements()).toHaveLength(3)
    await expect.element(list.getByText('grace@acme.test')).toBeVisible()
    await expect.element(list.getByText('Owner')).toBeVisible()
    await expect.element(list.getByText('Admin')).toBeVisible()
    await expect.element(list.getByText('· you')).toBeVisible()
  })

  it('adds workspace members who are not in the team, then posts their IDs', async () => {
    const { calls } = await show()
    await page.getByRole('button', { name: 'Add members' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add members to Web App' })
    await expect.element(dialog).toBeVisible()
    // Only the two who aren't in the team are offered, and nobody is picked yet.
    await expect.element(dialog.getByRole('checkbox', { name: /Omer Katz/ })).toBeVisible()
    expect(dialog.getByRole('checkbox').elements()).toHaveLength(2)
    await expect.element(dialog.getByRole('button', { name: 'Add 0 members' })).toBeDisabled()

    await userEvent.type(dialog.getByRole('textbox', { name: 'Find a workspace member' }), 'noa')
    expect(dialog.getByRole('checkbox').elements()).toHaveLength(1)
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
    await page.getByRole('button', { name: 'Remove Alan Turing from team' }).click()
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

  it('leaves the team with your own ID, after a confirmation that says what changes', async () => {
    const { calls, router } = await show()
    await page.getByRole('button', { name: 'Leave team' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Leave Web App?' })
    await expect.element(dialog).toMatchTextContent(/An owner or admin can add you back\./)
    await dialog.getByRole('button', { name: 'Leave team' }).click()
    await expect.poll(() => calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
    expect(calls.find((c) => c.method === 'DELETE')?.path).toBe(`${API}/members/u1`)
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/acme/settings/teams')
  })

  it('shows plain members the list and Leave only: no Add and no Remove', async () => {
    await show({ canManage: false, members: [ADA, member('u1b', 'Ada Two'), GRACE] })
    await expect.element(page.getByRole('list', { name: 'Team members' })).toBeVisible()
    expect(page.getByRole('button', { name: 'Add members' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: /^Remove / }).elements()).toHaveLength(0)
    await expect.element(page.getByRole('button', { name: 'Leave team' })).toBeVisible()
    expect(page.getByRole('button', { name: 'Leave team' }).elements()).toHaveLength(1)
  })
})
