import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { TeamDialogs } from '#features/teams/TeamDialogs.tsx'
import { TeamsPage } from '#features/teams/TeamsPage.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const caps = {
  canCreateWorkspace: false,
  instanceAdmin: false,
  manageableWorkspaces: [
    { slug: 'acme', name: 'Acme' },
    { slug: 'globex', name: 'Globex' },
  ],
  refusingWorkspaces: [],
}

const integration = {
  id: 'i1',
  kind: 'github',
  group: 'git',
  kindName: 'GitHub',
  name: 'Installation 5',
  needsAttention: false,
  attentionReason: null,
  teamCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const routes = () => ({
  'GET /api/teams': { body: { teams: [] } },
  'GET /api/capabilities': { body: caps },
  'GET /api/workspaces/acme/integrations': {
    body: { canManage: true, integrations: [integration], catalog: [] },
  },
  'GET /api/workspaces/globex/integrations': {
    body: { canManage: true, integrations: [], catalog: [] },
  },
  'GET /api/workspaces/acme/integrations/i1/targets': {
    body: { targets: [{ id: 'r1', name: 'acme/web' }] },
  },
  'POST /api/workspaces/acme/teams': {
    body: {
      team: { slug: 'checkout-flows', name: 'Checkout flows', color: 'slate', icon: null },
      token: 'circi_secret_token_value',
    },
  },
})

const show = () =>
  renderPage(
    <>
      <TeamsPage />
      <TeamDialogs />
    </>,
    { route: '/', url: '/', announcer: true },
  )

async function open() {
  const api = fakeApi(routes())
  const screen = await show()
  await page.getByRole('button', { name: 'New team' }).first().click()
  await expect.element(page.getByRole('dialog', { name: 'New team' })).toBeVisible()
  return { api, ...screen }
}

describe('New team dialog', () => {
  it('opens from the Teams page and from the empty state, and asks for a name first', async () => {
    const { api } = await open()
    await expect.element(page.getByText('Step 1 of 2')).toBeVisible()
    await page.getByRole('button', { name: 'Create team' }).click()
    await expect.element(page.getByText('Enter a name')).toBeVisible()
    expect(api.of('POST')).toHaveLength(0)
  })

  it('opens from anywhere through the overlay store', async () => {
    fakeApi(routes())
    await show()
    useOverlayStore.getState().setNewTeamOpen(true)
    await expect.element(page.getByRole('dialog', { name: 'New team' })).toBeVisible()
  })

  it('shows the address from the name and the default branch', async () => {
    await open()
    await page.getByRole('textbox', { name: 'Name' }).fill('Checkout flows')
    await expect.element(page.getByText('/acme/checkout-flows')).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Default branch' })).toHaveValue('main')
  })

  it('creates the team, then shows the token once with a tab per CI system', async () => {
    const { api, router } = await open()
    await page.getByRole('textbox', { name: 'Name' }).fill('Checkout flows')
    await page.getByRole('button', { name: 'Create team' }).click()
    const dialog = page.getByRole('dialog', { name: 'Team created' })
    await expect.element(dialog).toBeVisible()
    expect(api.of('POST')[0]).toMatchObject({ body: { name: 'Checkout flows' } })
    // Nothing else is sent when the branch is main and no repository was picked.
    expect(api.of('PATCH')).toHaveLength(0)
    expect(api.of('PUT')).toHaveLength(0)

    // The token, once.
    await expect.element(dialog.getByText('circi_secret_token_value')).toBeVisible()
    await expect.element(dialog.getByText(/only time the token is shown/)).toBeVisible()
    await expect.element(dialog.getByRole('button', { name: 'Copy CI token' })).toBeVisible()

    // One tab per CI system, GitHub Actions first, with this team and this server in it.
    const tabs = dialog
      .getByRole('tab')
      .elements()
      .map((el) => el.textContent)
    expect(tabs).toEqual(['GitHub Actions', 'GitLab CI', 'Bitbucket Pipelines', 'Jenkins', 'Other'])
    const panel = dialog.getByRole('tabpanel')
    await expect.element(panel).toMatchTextContent(/CirCI team: acme\/checkout-flows/)
    await expect.element(panel).toMatchTextContent(new RegExp(`CIRCI_API_URL: ${location.origin}`))
    await expect.element(panel).not.toMatchTextContent(/circi_secret_token_value/)

    // Arrow keys move between the tabs; the panel follows.
    // Click (not `.focus()`) so the dialog's own focus handling has settled before the key press.
    await dialog.getByRole('tab', { name: 'GitHub Actions' }).click()
    await expect.poll(() => document.activeElement?.textContent).toBe('GitHub Actions')
    await userEvent.keyboard('{ArrowRight}')
    await expect
      .element(dialog.getByRole('tab', { name: 'GitLab CI' }))
      .toHaveAttribute('aria-selected', 'true')
    await expect.element(panel).toMatchTextContent(/visual:/)
    await dialog.getByRole('tab', { name: 'Other' }).click()
    await expect.element(panel).toMatchTextContent(/export CIRCI_TOKEN=circi_secret_token_value/)

    // Each example has its own copy button.
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await dialog.getByRole('button', { name: 'Copy Other example' }).click()
    await expect.poll(() => writeText.mock.calls.length).toBe(1)
    expect(writeText.mock.calls[0]?.[0]).toContain('npx circi upload ./screenshots --wait')
    await expect
      .element(dialog.getByRole('button', { name: 'Copy Other example' }))
      .toHaveTextContent('Copied')

    // It can't be dismissed by accident: no close button, and Escape does nothing.
    expect(page.getByRole('button', { name: 'Close' }).elements()).toHaveLength(0)
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).toBeVisible()

    // Done closes it for good: the token is gone from the page, and the team opens.
    await page.getByRole('button', { name: 'Done' }).click()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('circi_secret_token_value')
    expect(router.state.location.pathname).toBe('/acme/checkout-flows')
  })

  it('sends the default branch and the repository in the one create call', async () => {
    const { api } = await open()
    await page.getByRole('textbox', { name: 'Name' }).fill('Checkout flows')
    await page.getByRole('textbox', { name: 'Default branch' }).fill('develop')
    await page.getByRole('combobox', { name: /Link a repository/ }).click()
    await page.getByRole('option', { name: 'acme/web' }).click()
    await page.getByRole('button', { name: 'Create team' }).click()
    const dialog = page.getByRole('dialog', { name: 'Team created' })
    await expect.element(dialog).toBeVisible()
    expect(api.of('POST')).toEqual([
      {
        method: 'POST',
        path: '/api/workspaces/acme/teams',
        body: {
          name: 'Checkout flows',
          defaultBranch: 'develop',
          repository: { integration: 'i1', ref: 'r1', name: 'acme/web' },
        },
      },
    ])
    expect(api.of('PATCH')).toHaveLength(0)
    expect(api.of('PUT')).toHaveLength(0)
    // A linked repository means the pull request's check is the gate.
    await expect
      .element(dialog)
      .toMatchTextContent(/the check on the pull request is the merge gate/)
  })

  it('creates nothing and keeps the form when the server refuses the repository', async () => {
    const { api } = await open()
    api.set('POST /api/workspaces/acme/teams', {
      status: 400,
      body: { error: 'repository: not a git integration of this workspace' },
    })
    await page.getByRole('textbox', { name: 'Name' }).fill('Checkout flows')
    await page.getByRole('combobox', { name: /Link a repository/ }).click()
    await page.getByRole('option', { name: 'acme/web' }).click()
    await page.getByRole('button', { name: 'Create team' }).click()
    await expect.element(page.getByText(/not a git integration of this workspace/)).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Checkout flows')
  })

  it('creates in the chosen workspace', async () => {
    const { api } = await open()
    api.set('POST /api/workspaces/globex/teams', {
      body: {
        team: { slug: 'portal', name: 'Portal', color: 'plum', icon: null },
        token: 'circi_t',
      },
    })
    await page.getByRole('combobox', { name: 'Workspace' }).click()
    await page.getByRole('option', { name: 'Globex' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Portal')
    await page.getByRole('button', { name: 'Create team' }).click()
    await expect.element(page.getByRole('dialog', { name: 'Team created' })).toBeVisible()
    expect(api.of('POST')[0]).toMatchObject({ path: '/api/workspaces/globex/teams' })
  })

  it("shows the server's refusal and keeps the form", async () => {
    const { api } = await open()
    api.set('POST /api/workspaces/acme/teams', { status: 400, body: { error: 'Name is too long' } })
    await page.getByRole('textbox', { name: 'Name' }).fill('x'.repeat(300))
    await page.getByRole('button', { name: 'Create team' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Name is too long')
    await expect.element(page.getByRole('dialog', { name: 'New team' })).toBeVisible()
  })

  it('closes with Cancel and Escape before anything is created', async () => {
    await open()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'New team' }).first().click()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })
})
