import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { TeamsPage } from '#features/teams/TeamsPage.tsx'
import { fakeApi, hangingFetch, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

import { build } from './support.tsx'

afterEach(() => restoreFetch())

const overview = (workspace: string, team: string, latestBuild: unknown = null) => ({
  workspace: { slug: workspace, name: workspace.toUpperCase() },
  team: { slug: team, name: team, defaultBranch: 'main' },
  latestBuild,
})

const caps = (over: Record<string, unknown> = {}) => ({
  canCreateWorkspace: false,
  manageableWorkspaces: [],
  refusingWorkspaces: [],
  ...over,
})

const show = () => renderPage(<TeamsPage />, { route: '/', url: '/', announcer: true })

const openWorkspaceDialog = async () => {
  const api = fakeApi({
    'GET /api/teams': { body: { teams: [overview('acme', 'web')] } },
    'GET /api/capabilities': { body: caps({ canCreateWorkspace: true }) },
    'POST /api/workspaces': (body) => ({
      body: {
        workspace: {
          slug: 'globex',
          name:
            typeof body === 'object' && body !== null && 'name' in body ? String(body.name) : '',
        },
      },
    }),
  })
  await show()
  await page.getByRole('button', { name: 'New workspace' }).click()
  await expect.element(page.getByRole('dialog', { name: 'New workspace' })).toBeVisible()
  return api
}

const openTeamDialog = async () => {
  const api = fakeApi({
    'GET /api/teams': { body: { teams: [overview('acme', 'web')] } },
    'GET /api/capabilities': {
      body: caps({
        manageableWorkspaces: [
          { slug: 'acme', name: 'Acme' },
          { slug: 'globex', name: 'Globex' },
        ],
      }),
    },
    'POST /api/workspaces/globex/teams': {
      body: { team: { slug: 'portal', name: 'Portal' }, token: 'circi_secret_token' },
    },
  })
  const screen = await show()
  await page.getByRole('button', { name: 'New team' }).click()
  await expect.element(page.getByRole('dialog', { name: 'New team' })).toBeVisible()
  return { api, ...screen }
}

describe('TeamsPage', () => {
  it('shows nothing but the header while loading, then announces it if it takes long', async () => {
    hangingFetch()
    await show()
    await expect.element(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
    expect(page.getByRole('list', { name: 'Teams' }).elements()).toHaveLength(0)
    await expect.element(page.getByRole('status').first()).toHaveTextContent('Loading teams', {
      timeout: 2_000,
    })
  })

  it('lists teams with their latest build’s status, counts and meta, linking to the builds', async () => {
    fakeApi({
      'GET /api/teams': {
        body: {
          teams: [
            overview('acme', 'web-app', build(7, { branch: 'feature/x', prNumber: 12 })),
            overview('acme', 'storybook'),
          ],
        },
      },
      'GET /api/capabilities': { body: caps() },
    })
    await show()
    const list = page.getByRole('list', { name: 'Teams' })
    await expect.element(list).toBeVisible()
    const web = page.getByRole('link', { name: /web-app/ })
    await expect.element(web).toHaveAttribute('href', '/acme/web-app')
    await expect.element(page.getByRole('img', { name: 'Needs review' }).first()).toBeVisible()
    await expect.element(page.getByText('2 changed')).toBeVisible()
    await expect.element(page.getByText('PR #12')).toBeVisible()
    await expect.element(page.getByText('feature/x')).toBeVisible()
    await expect.element(page.getByText('abcdef7')).toBeVisible()
    await expect.element(page.getByText('No builds yet')).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'No builds yet' })).toBeVisible()
  })

  it('navigates to a team when its link is clicked', async () => {
    fakeApi({
      'GET /api/teams': { body: { teams: [overview('acme', 'web-app')] } },
      'GET /api/capabilities': { body: caps() },
    })
    const { router } = await show()
    await page.getByRole('link', { name: /web-app/ }).click()
    expect(router.state.location.pathname).toBe('/acme/web-app')
  })

  it('offers to create a team when you can, in the empty state and the header', async () => {
    fakeApi({
      'GET /api/teams': { body: { teams: [] } },
      'GET /api/capabilities': {
        body: caps({ manageableWorkspaces: [{ slug: 'acme', name: 'Acme' }] }),
      },
    })
    await show()
    await expect
      .element(page.getByRole('heading', { name: 'Create your first team' }))
      .toBeVisible()
    await expect.element(page.getByText(/A team holds the screenshot builds/)).toBeVisible()
    await expect
      .poll(() => page.getByRole('button', { name: 'New team' }).elements().length)
      .toBe(2)
  })

  it('says to create a workspace first when you can only do that', async () => {
    fakeApi({
      'GET /api/teams': { body: { teams: [] } },
      'GET /api/capabilities': { body: caps({ canCreateWorkspace: true }) },
    })
    await show()
    await expect
      .element(page.getByText('Create a workspace first, then add a team to it.'))
      .toBeVisible()
    await expect
      .poll(() => page.getByRole('button', { name: 'New workspace' }).elements().length)
      .toBe(2)
    expect(page.getByRole('button', { name: 'New team' }).elements()).toHaveLength(0)
  })

  it('explains that you need to ask when you can create nothing', async () => {
    fakeApi({
      'GET /api/teams': { body: { teams: [] } },
      'GET /api/capabilities': { body: caps() },
    })
    await show()
    await expect.element(page.getByText(/Ask one to add you/)).toBeVisible()
    expect(page.getByRole('button', { name: /New/ }).elements()).toHaveLength(0)
  })

  it('tells which sign-in methods a workspace accepts', async () => {
    fakeApi({
      'GET /api/teams': { body: { teams: [overview('acme', 'web')] } },
      'GET /api/capabilities': {
        body: caps({
          refusingWorkspaces: [
            { name: 'Globex', accepts: ['password', 'email'] },
            { name: 'Initech', accepts: [] },
          ],
        }),
      },
    })
    await show()
    await expect
      .element(
        page.getByText(
          /Globex only shows its teams to people who signed in with a password or an email code/,
        ),
      )
      .toBeVisible()
    await expect.element(page.getByText(/Initech .* another method/)).toBeVisible()
  })

  it('shows the error and retries', async () => {
    const api = fakeApi({
      'GET /api/teams': { status: 500, body: { error: 'database is down' } },
      'GET /api/capabilities': { body: caps() },
    })
    await show()
    await expect.element(page.getByText('database is down')).toBeVisible()
    api.set('GET /api/teams', { body: { teams: [overview('acme', 'web')] } })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.element(page.getByRole('link', { name: /web/ })).toBeVisible()
  })

  describe('New workspace', () => {
    it('asks for a name and sends nothing without one', async () => {
      const api = await openWorkspaceDialog()
      await page.getByRole('button', { name: 'Create' }).click()
      await expect.element(page.getByText('Enter a name')).toBeVisible()
      expect(api.of('POST')).toHaveLength(0)
    })

    it('creates it, announces it and closes', async () => {
      const api = await openWorkspaceDialog()
      await page.getByRole('textbox', { name: 'Name' }).fill('  Globex  ')
      await page.getByRole('button', { name: 'Create' }).click()
      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
      expect(api.of('POST')).toEqual([
        { method: 'POST', path: '/api/workspaces', body: { name: 'Globex' } },
      ])
      await expect
        .element(page.getByRole('status').first())
        .toHaveTextContent('Workspace Globex created')
    })

    it('shows the server’s refusal and keeps the dialog open', async () => {
      const api = await openWorkspaceDialog()
      api.set('POST /api/workspaces', { status: 409, body: { error: 'That name is taken' } })
      await page.getByRole('textbox', { name: 'Name' }).fill('Globex')
      await page.getByRole('button', { name: 'Create' }).click()
      await expect.element(page.getByRole('alert')).toHaveTextContent('That name is taken')
      await expect.element(page.getByRole('dialog', { name: 'New workspace' })).toBeVisible()
    })

    it('closes with Cancel and Escape', async () => {
      await openWorkspaceDialog()
      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
      await page.getByRole('button', { name: 'New workspace' }).click()
      await userEvent.keyboard('{Escape}')
      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('New team', () => {
    it('starts on the first workspace and asks for a name', async () => {
      const { api } = await openTeamDialog()
      await expect
        .element(page.getByRole('combobox', { name: 'Workspace' }))
        .toHaveTextContent('Acme')
      await expect.element(page.getByText('Usually the repository’s name.')).toBeVisible()
      await page.getByRole('button', { name: 'Create' }).click()
      await expect.element(page.getByText('Enter a name')).toBeVisible()
      expect(api.of('POST')).toHaveLength(0)
    })

    it('creates the team in the chosen workspace and shows the CI token once', async () => {
      const { api, router } = await openTeamDialog()
      await page.getByRole('combobox', { name: 'Workspace' }).click()
      await page.getByRole('option', { name: 'Globex' }).click()
      await page.getByRole('textbox', { name: 'Name' }).fill('Portal')
      await page.getByRole('button', { name: 'Create' }).click()
      const dialog = page.getByRole('dialog', { name: 'Team created' })
      await expect.element(dialog).toBeVisible()
      await expect.element(page.getByText('circi_secret_token')).toBeVisible()
      await expect.element(page.getByText(/isn’t shown again/)).toBeVisible()
      expect(api.of('POST')[0]).toMatchObject({ body: { name: 'Portal' } })
      // It can't be dismissed by accident: no close button, and Escape does nothing.
      expect(page.getByRole('button', { name: 'Close' }).elements()).toHaveLength(0)
      await userEvent.keyboard('{Escape}')
      await expect.element(dialog).toBeVisible()
      await page.getByRole('button', { name: 'I’ve saved it' }).click()
      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/globex/portal')
    })

    it('shows the server’s refusal', async () => {
      const { api } = await openTeamDialog()
      api.set('POST /api/workspaces/acme/teams', {
        status: 400,
        body: { error: 'Name is too long' },
      })
      await page.getByRole('textbox', { name: 'Name' }).fill('x'.repeat(300))
      await page.getByRole('button', { name: 'Create' }).click()
      await expect.element(page.getByRole('alert')).toHaveTextContent('Name is too long')
    })
  })
})
