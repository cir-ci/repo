import { AnnouncerProvider } from '@circi/ui'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it.
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { MembersPage } from '#features/members/MembersPage.tsx'
import { ADA, mockAuthClient, setSignedInUser } from '#test/support/auth-client.ts'
import { fakeFetch } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const ada = {
  id: 'm1',
  userId: 'u1',
  role: 'owner',
  user: { name: 'Ada Lovelace', email: 'ada@example.test' },
}
const grace = {
  id: 'm2',
  userId: 'u2',
  role: 'member',
  user: { name: 'Grace Hopper', email: 'grace@example.test' },
}
const invitation = {
  id: 'i1',
  email: 'alan@example.test',
  role: 'admin',
  status: 'pending',
  expiresAt: new Date(Date.now() + 3 * 86_400_000),
}
const workspace = (over: object = {}) => ({
  id: 'workspace1',
  name: 'Acme',
  slug: 'acme',
  members: [ada, grace],
  invitations: [
    invitation,
    { ...invitation, id: 'i2', email: 'old@example.test', status: 'canceled' },
  ],
  ...over,
})

// The route is `workspaces/$workspace/members`; the test route's path is that literal, so the slug is "$workspace".
const PATH = '/workspaces/$workspace/settings/members'
const SETTINGS = {
  'GET /api/workspaces/%24workspace/auth': {
    canManage: true,
    settings: { emailLoginEnabled: true, passwordLoginEnabled: true },
    instance: { password: true, email: true },
  },
  'GET /api/workspaces/%24workspace/members/sign-in': {
    members: [
      { userId: 'u1', methods: ['password', 'sso'] },
      { userId: 'u2', methods: ['github', 'google', 'oidc'] },
    ],
  },
  'GET /api/workspaces/%24workspace/domains': { domains: [] },
  'GET /api/workspaces/%24workspace/sso': { providers: [] },
}

const show = () =>
  renderPage(
    <AnnouncerProvider>
      <MembersPage />
    </AnnouncerProvider>,
    { route: PATH },
  )

const auth = mockAuthClient().organization

beforeEach(() => {
  vi.resetAllMocks()
  auth.getFullOrganization.mockResolvedValue({ data: workspace(), error: null })
  fakeFetch(SETTINGS)
})
describe('MembersPage', () => {
  it('shows a skeleton while loading, announces it, and the header names the workspace after', async () => {
    await page.viewport(1000, 800)
    auth.getFullOrganization.mockReturnValue(new Promise(() => {}))
    await show()
    await expect
      .element(page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('Members'))
      .toBeVisible()
    expect(document.querySelector('[data-slot="skeleton-list"]')).not.toBeNull()
    expect(page.getByText('Ada Lovelace').elements()).toHaveLength(0)
    await expect
      .element(page.getByRole('status').filter({ hasText: 'Loading members' }))
      .toBeInTheDocument()
  })

  it('tags each member with how they sign in: one tag per method, SSO once', async () => {
    await page.viewport(1000, 800)
    await show()
    const adaTags = page.getByRole('list', { name: 'How Ada Lovelace signs in' })
    await expect.element(adaTags).toBeVisible()
    expect(
      adaTags
        .getByRole('listitem')
        .elements()
        .map((e) => e.textContent),
    ).toEqual(['Password', 'SSO'])
    const graceTags = page.getByRole('list', { name: 'How Grace Hopper signs in' })
    expect(
      graceTags
        .getByRole('listitem')
        .elements()
        .map((e) => e.textContent),
    ).toEqual(['GitHub', 'Google', 'SSO'])
  })

  it('shows no tags to people who may not see them', async () => {
    await page.viewport(1000, 800)
    setSignedInUser({ ...ADA, id: 'u2' })
    await show()
    await expect.element(page.getByText('Grace Hopper')).toBeVisible()
    expect(page.getByRole('list', { name: /signs in/ }).elements()).toHaveLength(0)
  })

  it('lists members with avatar, name, email and role, and the pending invitations', async () => {
    await page.viewport(1000, 800)
    await show()
    await expect
      .element(page.getByRole('heading', { name: 'Members', exact: true, level: 2 }))
      .toBeVisible()
    await expect.element(page.getByText('2 people')).toBeVisible()
    await expect.element(page.getByText('Ada Lovelace')).toBeVisible()
    await expect.element(page.getByText('ada@example.test')).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Grace Hopper' })).toBeVisible()
    await expect.element(page.getByText('grace@example.test')).toBeVisible()
    await expect
      .element(page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('Acme'))
      .toBeVisible()
    // Yourself and the owner have no controls; another member has a role picker and a row menu.
    await expect.element(page.getByText('Owner')).toBeVisible()
    await expect
      .element(page.getByRole('combobox', { name: 'Role of Grace Hopper' }))
      .toHaveTextContent('Member')
    expect(page.getByRole('combobox', { name: 'Role of Ada Lovelace' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'Actions for Ada Lovelace' }).elements()).toHaveLength(
      0,
    )
    await expect
      .element(page.getByRole('button', { name: 'Actions for Grace Hopper' }))
      .toBeVisible()
    // Only pending invitations are listed.
    await expect.element(page.getByRole('heading', { name: 'Pending invitations' })).toBeVisible()
    await expect.element(page.getByText('alan@example.test')).toBeVisible()
    expect(page.getByText('old@example.test').elements()).toHaveLength(0)
    expect(document.title).toBe('Members · $workspace · CirCI')
  })

  it('offers inviting to owners and admins, and keeps sign-in settings on their own page', async () => {
    await page.viewport(1000, 800)
    await show()
    await expect.element(page.getByRole('heading', { name: 'Invite someone' })).toBeVisible()
    for (const name of ['Sign-in methods', 'Email domains', 'Single sign-on']) {
      expect(page.getByRole('heading', { name }).elements()).toHaveLength(0)
    }
    await expect
      .element(page.getByRole('link', { name: 'Sign-in and domains' }))
      .toHaveAttribute('href', '/workspaces/%24workspace/settings/sign-in')
  })

  it('shows a plain member the list and nothing to manage', async () => {
    await page.viewport(1000, 800)
    setSignedInUser({ ...ADA, id: 'u2' })
    await show()
    await expect.element(page.getByText('Ada Lovelace')).toBeVisible()
    await expect.element(page.getByText('Owner')).toBeVisible()
    expect(page.getByRole('combobox').elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: /^Actions for/ }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'Revoke' }).elements()).toHaveLength(0)
    expect(page.getByRole('heading', { name: 'Invite someone' }).elements()).toHaveLength(0)
    await expect.element(page.getByText(/Only owners and admins can invite/)).toBeVisible()
  })

  it('says so when you are the only member', async () => {
    await page.viewport(1000, 800)
    auth.getFullOrganization.mockResolvedValue({ data: workspace({ members: [ada] }), error: null })
    await show()
    await expect.element(page.getByText('1 person')).toBeVisible()
    await expect
      .element(page.getByRole('heading', { name: 'No one else is here yet' }))
      .toBeVisible()
  })

  it('says the workspace doesn’t exist for an unknown slug', async () => {
    await page.viewport(1000, 800)
    auth.getFullOrganization.mockResolvedValue({ data: null, error: null })
    await show()
    await expect
      .element(page.getByRole('heading', { name: 'This workspace doesn’t exist' }))
      .toBeVisible()
  })

  it('shows other failures with a retry that loads again', async () => {
    await page.viewport(1000, 800)
    auth.getFullOrganization.mockResolvedValueOnce({
      data: null,
      error: { status: 500, message: 'Database is down' },
    })
    await show()
    await expect.element(page.getByText('Database is down')).toBeVisible()
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.element(page.getByText('Grace Hopper')).toBeVisible()
    expect(auth.getFullOrganization).toHaveBeenCalledTimes(2)
  })

  it('changes a member’s role from the picker and announces it', async () => {
    await page.viewport(1000, 800)
    auth.updateMemberRole.mockResolvedValue({ data: {}, error: null })
    await show()
    await page.getByRole('combobox', { name: 'Role of Grace Hopper' }).click()
    await page.getByRole('option', { name: 'Admin' }).click()
    expect(auth.updateMemberRole).toHaveBeenCalledWith({
      memberId: 'm2',
      role: 'admin',
      organizationId: 'workspace1',
    })
    await expect
      .element(page.getByRole('status').filter({ hasText: 'Grace Hopper is now Admin' }))
      .toBeInTheDocument()
    // The list is fetched again afterwards.
    await vi.waitFor(() => expect(auth.getFullOrganization).toHaveBeenCalledTimes(2))
  })

  it('shows why a role change failed', async () => {
    await page.viewport(1000, 800)
    auth.updateMemberRole.mockResolvedValue({
      data: null,
      error: { message: 'Only owners can do that' },
    })
    await show()
    await page.getByRole('combobox', { name: 'Role of Grace Hopper' }).click()
    await page.getByRole('option', { name: 'Admin' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Only owners can do that')
  })

  it('removes a member only after confirming', async () => {
    await page.viewport(1000, 800)
    auth.removeMember.mockResolvedValue({ data: {}, error: null })
    await show()
    await page.getByRole('button', { name: 'Actions for Grace Hopper' }).click()
    await page.getByRole('menuitem', { name: 'Remove from workspace' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Remove Grace Hopper?' })
    await expect.element(dialog).toBeVisible()
    await expect
      .element(dialog.getByText(/grace@example\.test will lose access to Acme/))
      .toBeVisible()
    expect(auth.removeMember).not.toHaveBeenCalled()

    // Cancel does nothing.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(auth.removeMember).not.toHaveBeenCalled()

    await page.getByRole('button', { name: 'Actions for Grace Hopper' }).click()
    await page.getByRole('menuitem', { name: 'Remove from workspace' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click()
    expect(auth.removeMember).toHaveBeenCalledWith({
      memberIdOrEmail: 'm2',
      organizationId: 'workspace1',
    })
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('status').filter({ hasText: 'Member removed' }))
      .toBeInTheDocument()
  })

  it('closes the dialog and shows the failure when removing fails', async () => {
    await page.viewport(1000, 800)
    auth.removeMember.mockResolvedValue({ data: null, error: {} })
    await show()
    await page.getByRole('button', { name: 'Actions for Grace Hopper' }).click()
    await page.getByRole('menuitem', { name: 'Remove from workspace' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Couldn’t remove this member')
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('revokes a pending invitation', async () => {
    await page.viewport(1000, 800)
    auth.cancelInvitation.mockResolvedValue({ data: {}, error: null })
    await show()
    await expect.element(page.getByText(/Admin · expires/)).toBeVisible()
    await page.getByRole('button', { name: 'Revoke' }).click()
    expect(auth.cancelInvitation).toHaveBeenCalledWith({ invitationId: 'i1' })
    await expect
      .element(page.getByRole('status').filter({ hasText: 'Invitation revoked' }))
      .toBeInTheDocument()
  })

  it('resends a pending invitation to the same address and role', async () => {
    await page.viewport(1000, 800)
    auth.inviteMember.mockResolvedValue({ data: {}, error: null })
    await show()
    await page.getByRole('button', { name: 'Resend' }).click()
    expect(auth.inviteMember).toHaveBeenCalledWith({
      email: 'alan@example.test',
      role: 'admin',
      organizationId: 'workspace1',
      resend: true,
    })
    await expect
      .element(
        page.getByRole('status').filter({ hasText: 'Invitation sent again to alan@example.test' }),
      )
      .toBeInTheDocument()
  })

  it('marks your own row with "you" and nobody else’s', async () => {
    await page.viewport(1000, 800)
    await show()
    await expect.element(page.getByText('· you')).toBeVisible()
    expect(page.getByText('· you').elements()).toHaveLength(1)
  })

  it('puts the invite form first, with an example address', async () => {
    await page.viewport(1000, 800)
    await show()
    await expect
      .element(page.getByRole('textbox', { name: 'Email' }))
      .toHaveAttribute('placeholder', 'name@acme.dev')
    const headings = page.getByRole('heading', { level: 2 }).elements()
    expect(headings.map((h) => h.textContent)).toEqual([
      'Invite someone',
      'Members',
      'Pending invitations',
    ])
  })

  it('invites someone from the form on the page, then lists again', async () => {
    await page.viewport(1000, 800)
    auth.inviteMember.mockResolvedValue({ data: {}, error: null })
    await show()
    await page.getByRole('textbox', { name: 'Email' }).fill('new@example.test')
    await page.getByRole('button', { name: 'Send invite' }).click()
    expect(auth.inviteMember).toHaveBeenCalledWith({
      email: 'new@example.test',
      role: 'member',
      organizationId: 'workspace1',
    })
    await vi.waitFor(() => expect(auth.getFullOrganization).toHaveBeenCalledTimes(2))
  })
})
