import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { ProjectsPage } from '../../../src/features/projects/ProjectsPage.tsx'
import { renderPage } from '../../support/render.tsx'
import { fakeApi, hangingFetch, restoreFetch } from '../fetch-routes.ts'
import { build } from './support.tsx'

afterEach(() => restoreFetch())

const overview = (org: string, project: string, latestBuild: unknown = null) => ({
  org: { slug: org, name: org.toUpperCase() },
  project: { slug: project, name: project, defaultBranch: 'main' },
  latestBuild,
})

const caps = (over: Record<string, unknown> = {}) => ({
  canCreateOrganization: false,
  manageableOrganizations: [],
  refusingOrganizations: [],
  ...over,
})

const show = () => renderPage(<ProjectsPage />, { route: '/', url: '/', announcer: true })

const openOrganizationDialog = async () => {
  const api = fakeApi({
    'GET /api/projects': { body: { projects: [overview('acme', 'web')] } },
    'GET /api/capabilities': { body: caps({ canCreateOrganization: true }) },
    'POST /api/organizations': (body) => ({
      body: {
        organization: {
          slug: 'globex',
          name:
            typeof body === 'object' && body !== null && 'name' in body ? String(body.name) : '',
        },
      },
    }),
  })
  await show()
  await page.getByRole('button', { name: 'New organization' }).click()
  await expect.element(page.getByRole('dialog', { name: 'New organization' })).toBeVisible()
  return api
}

const openProjectDialog = async () => {
  const api = fakeApi({
    'GET /api/projects': { body: { projects: [overview('acme', 'web')] } },
    'GET /api/capabilities': {
      body: caps({
        manageableOrganizations: [
          { slug: 'acme', name: 'Acme' },
          { slug: 'globex', name: 'Globex' },
        ],
      }),
    },
    'POST /api/organizations/globex/projects': {
      body: { project: { slug: 'portal', name: 'Portal' }, token: 'circi_secret_token' },
    },
  })
  const screen = await show()
  await page.getByRole('button', { name: 'New project' }).click()
  await expect.element(page.getByRole('dialog', { name: 'New project' })).toBeVisible()
  return { api, ...screen }
}

describe('ProjectsPage', () => {
  it('shows nothing but the header while loading, then announces it if it takes long', async () => {
    hangingFetch()
    await show()
    await expect.element(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
    expect(page.getByRole('list', { name: 'Projects' }).elements()).toHaveLength(0)
    await expect.element(page.getByRole('status').first()).toHaveTextContent('Loading projects', {
      timeout: 2_000,
    })
  })

  it('lists projects with their latest build’s status, counts and meta, linking to the builds', async () => {
    fakeApi({
      'GET /api/projects': {
        body: {
          projects: [
            overview('acme', 'web-app', build(7, { branch: 'feature/x', prNumber: 12 })),
            overview('acme', 'storybook'),
          ],
        },
      },
      'GET /api/capabilities': { body: caps() },
    })
    await show()
    const list = page.getByRole('list', { name: 'Projects' })
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

  it('navigates to a project when its link is clicked', async () => {
    fakeApi({
      'GET /api/projects': { body: { projects: [overview('acme', 'web-app')] } },
      'GET /api/capabilities': { body: caps() },
    })
    const { router } = await show()
    await page.getByRole('link', { name: /web-app/ }).click()
    expect(router.state.location.pathname).toBe('/acme/web-app')
  })

  it('offers to create a project when you can, in the empty state and the header', async () => {
    fakeApi({
      'GET /api/projects': { body: { projects: [] } },
      'GET /api/capabilities': {
        body: caps({ manageableOrganizations: [{ slug: 'acme', name: 'Acme' }] }),
      },
    })
    await show()
    await expect
      .element(page.getByRole('heading', { name: 'Create your first project' }))
      .toBeVisible()
    await expect.element(page.getByText(/A project holds the screenshot builds/)).toBeVisible()
    await expect
      .poll(() => page.getByRole('button', { name: 'New project' }).elements().length)
      .toBe(2)
  })

  it('says to create an organization first when you can only do that', async () => {
    fakeApi({
      'GET /api/projects': { body: { projects: [] } },
      'GET /api/capabilities': { body: caps({ canCreateOrganization: true }) },
    })
    await show()
    await expect
      .element(page.getByText('Create an organization first, then add a project to it.'))
      .toBeVisible()
    await expect
      .poll(() => page.getByRole('button', { name: 'New organization' }).elements().length)
      .toBe(2)
    expect(page.getByRole('button', { name: 'New project' }).elements()).toHaveLength(0)
  })

  it('explains that you need to ask when you can create nothing', async () => {
    fakeApi({
      'GET /api/projects': { body: { projects: [] } },
      'GET /api/capabilities': { body: caps() },
    })
    await show()
    await expect.element(page.getByText(/Ask one to add you/)).toBeVisible()
    expect(page.getByRole('button', { name: /New/ }).elements()).toHaveLength(0)
  })

  it('tells which sign-in methods an organization accepts', async () => {
    fakeApi({
      'GET /api/projects': { body: { projects: [overview('acme', 'web')] } },
      'GET /api/capabilities': {
        body: caps({
          refusingOrganizations: [
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
          /Globex only shows its projects to people who signed in with a password or an email code/,
        ),
      )
      .toBeVisible()
    await expect.element(page.getByText(/Initech .* another method/)).toBeVisible()
  })

  it('shows the error and retries', async () => {
    const api = fakeApi({
      'GET /api/projects': { status: 500, body: { error: 'database is down' } },
      'GET /api/capabilities': { body: caps() },
    })
    await show()
    await expect.element(page.getByText('database is down')).toBeVisible()
    api.set('GET /api/projects', { body: { projects: [overview('acme', 'web')] } })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.element(page.getByRole('link', { name: /web/ })).toBeVisible()
  })

  describe('New organization', () => {
    it('asks for a name and sends nothing without one', async () => {
      const api = await openOrganizationDialog()
      await page.getByRole('button', { name: 'Create' }).click()
      await expect.element(page.getByText('Enter a name')).toBeVisible()
      expect(api.of('POST')).toHaveLength(0)
    })

    it('creates it, announces it and closes', async () => {
      const api = await openOrganizationDialog()
      await page.getByRole('textbox', { name: 'Name' }).fill('  Globex  ')
      await page.getByRole('button', { name: 'Create' }).click()
      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
      expect(api.of('POST')).toEqual([
        { method: 'POST', path: '/api/organizations', body: { name: 'Globex' } },
      ])
      await expect
        .element(page.getByRole('status').first())
        .toHaveTextContent('Organization Globex created')
    })

    it('shows the server’s refusal and keeps the dialog open', async () => {
      const api = await openOrganizationDialog()
      api.set('POST /api/organizations', { status: 409, body: { error: 'That name is taken' } })
      await page.getByRole('textbox', { name: 'Name' }).fill('Globex')
      await page.getByRole('button', { name: 'Create' }).click()
      await expect.element(page.getByRole('alert')).toHaveTextContent('That name is taken')
      await expect.element(page.getByRole('dialog', { name: 'New organization' })).toBeVisible()
    })

    it('closes with Cancel and Escape', async () => {
      await openOrganizationDialog()
      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
      await page.getByRole('button', { name: 'New organization' }).click()
      await userEvent.keyboard('{Escape}')
      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('New project', () => {
    it('starts on the first organization and asks for a name', async () => {
      const { api } = await openProjectDialog()
      await expect
        .element(page.getByRole('combobox', { name: 'Organization' }))
        .toHaveTextContent('Acme')
      await expect.element(page.getByText('Usually the repository’s name.')).toBeVisible()
      await page.getByRole('button', { name: 'Create' }).click()
      await expect.element(page.getByText('Enter a name')).toBeVisible()
      expect(api.of('POST')).toHaveLength(0)
    })

    it('creates the project in the chosen organization and shows the CI token once', async () => {
      const { api, router } = await openProjectDialog()
      await page.getByRole('combobox', { name: 'Organization' }).click()
      await page.getByRole('option', { name: 'Globex' }).click()
      await page.getByRole('textbox', { name: 'Name' }).fill('Portal')
      await page.getByRole('button', { name: 'Create' }).click()
      const dialog = page.getByRole('dialog', { name: 'Project created' })
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
      const { api } = await openProjectDialog()
      api.set('POST /api/organizations/acme/projects', {
        status: 400,
        body: { error: 'Name is too long' },
      })
      await page.getByRole('textbox', { name: 'Name' }).fill('x'.repeat(300))
      await page.getByRole('button', { name: 'Create' }).click()
      await expect.element(page.getByRole('alert')).toHaveTextContent('Name is too long')
    })
  })
})
