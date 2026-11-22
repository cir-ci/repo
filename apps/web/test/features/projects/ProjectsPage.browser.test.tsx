import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { ProjectDialogs } from '#features/projects/ProjectDialogs.tsx'
import { ProjectsPage } from '#features/projects/ProjectsPage.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { fakeApi, hangingFetch } from '#test/support/fetch.ts'
import { pageHeader } from '#test/support/header.ts'
import { expectNoSidewaysScroll } from '#test/support/overflow.ts'
import { expectOnePrimaryPerArea } from '#test/support/primary-buttons.ts'
import { renderPage } from '#test/support/render.tsx'
import { openDialogs, toastNamed } from '#test/support/toast.ts'

import { build } from './support.tsx'

const overview = (workspace: string, project: string, latestBuild: unknown = null) => ({
  workspace: { slug: workspace, name: workspace.toUpperCase() },
  project: {
    slug: project,
    name: project,
    defaultBranch: 'main',
    memberCount: 2,
    memberPreview: [
      { id: 'u1', name: 'Ada Lovelace', image: null },
      { id: 'u2', name: 'Grace Hopper', image: null },
    ],
    youAreMember: true,
  },
  latestBuild,
})

const caps = (over: Record<string, unknown> = {}) => ({
  canCreateWorkspace: false,
  instanceAdmin: false,
  manageableWorkspaces: [],
  refusingWorkspaces: [],
  ...over,
})

// The New project and New workspace dialogs belong to the shell: the page only opens them.
const show = () =>
  renderPage(
    <>
      <ProjectsPage />
      <ProjectDialogs />
    </>,
    { route: '/', url: '/', announcer: true },
  )

const openWorkspaceDialog = async () => {
  const api = fakeApi({
    'GET /api/projects': { body: { projects: [overview('acme', 'web')] } },
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
  useOverlayStore.getState().setNewWorkspaceOpen(true)
  await expect.element(page.getByRole('dialog', { name: 'New workspace' })).toBeVisible()
  return api
}

describe('ProjectsPage', () => {
  it('lists the projects of every workspace, one group per workspace, and counts them all', async () => {
    fakeApi({
      'GET /api/projects': {
        body: {
          projects: [
            overview('qa-co', 'checkout'),
            overview('acme', 'web-app'),
            overview('acme', 'storybook'),
          ],
        },
      },
      'GET /api/capabilities': { body: caps() },
    })
    await show()
    const acme = page.getByRole('list', { name: 'ACME projects' })
    const qa = page.getByRole('list', { name: 'QA-CO projects' })
    await expect.element(acme.getByText('acme/web-app')).toBeVisible()
    await expect.element(acme.getByText('acme/storybook')).toBeVisible()
    await expect.element(qa.getByText('qa-co/checkout')).toBeVisible()
    // A group header per workspace, in name order, with its count.
    const headings = page.getByRole('heading', { level: 2 }).elements()
    expect(headings.map((h) => h.textContent)).toEqual(['ACME2', 'QA-CO1'])
    await expect.element(page.getByLabelText('3 projects', { exact: true })).toBeVisible()
  })

  it('shows no group header with a single workspace', async () => {
    fakeApi({
      'GET /api/projects': {
        body: { projects: [overview('acme', 'web-app'), overview('acme', 'api')] },
      },
      'GET /api/capabilities': { body: caps() },
    })
    await show()
    await expect.element(page.getByRole('list', { name: 'Projects' })).toBeVisible()
    expect(page.getByRole('heading', { level: 2 }).elements()).toHaveLength(0)
  })

  it('keeps one New project in the header, whichever workspaces there are', async () => {
    fakeApi({
      'GET /api/projects': {
        body: { projects: [overview('acme', 'web'), overview('qa-co', 'checkout')] },
      },
      'GET /api/capabilities': {
        body: caps({
          manageableWorkspaces: [
            { slug: 'acme', name: 'ACME' },
            { slug: 'qa-co', name: 'QA-CO' },
          ],
        }),
      },
    })
    await show()
    await expect
      .poll(() => page.getByRole('button', { name: 'New project' }).elements().length)
      .toBe(1)
    expect(pageHeader().contains(page.getByRole('button', { name: 'New project' }).element())).toBe(
      true,
    )
    await page.getByRole('button', { name: 'New project' }).click()
    // The dialog asks which workspace.
    await expect.element(page.getByRole('dialog', { name: 'New project' })).toBeVisible()
    expectOnePrimaryPerArea()
  })

  it('shows nothing but the header while loading, then announces it if it takes long', async () => {
    hangingFetch()
    await show()
    await expect.element(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
    expect(page.getByRole('list', { name: 'Projects' }).elements()).toHaveLength(0)
    await expect.element(page.getByRole('status').first()).toHaveTextContent('Loading projects')
  })

  it("lists projects with their latest build's status, counts and meta, linking to the builds", async () => {
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
    await expect.element(page.getByText('#7')).toBeVisible()
    await expect.element(page.getByText('feature/x')).toBeVisible()
    await expect.element(page.getByText('acme/web-app')).toBeVisible()
    // A project has a build: no "Connect a CI job" block.
    expect(page.getByText('Connect a CI job').elements()).toHaveLength(0)
    await expect.element(page.getByText('No builds yet')).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'No builds yet' })).toBeVisible()
  })

  it('shows the Connect a CI job panel while no project has a build', async () => {
    fakeApi({
      'GET /api/projects': { body: { projects: [overview('acme', 'web-app')] } },
      'GET /api/capabilities': { body: caps() },
    })
    await show()
    await expect.element(page.getByText('Connect a CI job')).toBeVisible()
    await expect.element(page.getByText('npx circi upload ./screenshots --wait')).toBeVisible()
  })

  it('hides the Connect a CI job panel once any project has a build', async () => {
    fakeApi({
      'GET /api/projects': { body: { projects: [overview('acme', 'web-app', build(7))] } },
      'GET /api/capabilities': { body: caps() },
    })
    await show()
    await expect.element(page.getByRole('link', { name: /web-app/ })).toBeVisible()
    expect(page.getByText('Connect a CI job').elements()).toHaveLength(0)
  })

  it('has no New workspace button in the header (it lives in the workspace switcher)', async () => {
    fakeApi({
      'GET /api/projects': { body: { projects: [overview('acme', 'web-app')] } },
      'GET /api/capabilities': {
        body: caps({
          canCreateWorkspace: true,
          manageableWorkspaces: [{ slug: 'acme', name: 'Acme' }],
        }),
      },
    })
    await show()
    await expect.element(page.getByRole('button', { name: 'New project' })).toBeVisible()
    expect(page.getByRole('button', { name: 'New workspace' }).elements()).toHaveLength(0)
  })

  it('navigates to a project when its link is clicked', async () => {
    fakeApi({
      'GET /api/projects': { body: { projects: [overview('acme', 'web-app')] } },
      'GET /api/capabilities': { body: caps() },
    })
    const { router } = await show()
    await page.getByRole('link', { name: /web-app/ }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app')
  })

  it('offers to create a project when you can, in the header only (the empty state has no button)', async () => {
    fakeApi({
      'GET /api/projects': { body: { projects: [] } },
      'GET /api/capabilities': {
        body: caps({ manageableWorkspaces: [{ slug: 'acme', name: 'Acme' }] }),
      },
    })
    await show()
    await expectEmptyState('Create your first project', {
      body: 'A project is one app or library whose screenshots your CI uploads.',
      centred: true,
    })
    // The Argos hint is a footnote below the state, not a second action.
    await expect.element(page.getByText(/Already uploading with Argos\?/)).toBeVisible()
    await expect.element(page.getByText(/ARGOS_API_BASE_URL=/)).toBeVisible()
    await expect
      .poll(() => page.getByRole('button', { name: 'New project' }).elements().length)
      .toBe(1)
    expect(pageHeader().contains(page.getByRole('button', { name: 'New project' }).element())).toBe(
      true,
    )
    expectOnePrimaryPerArea()
  })

  it('says to create a workspace first when you can only do that', async () => {
    fakeApi({
      'GET /api/projects': { body: { projects: [] } },
      'GET /api/capabilities': { body: caps({ canCreateWorkspace: true }) },
    })
    await show()
    await expectEmptyState('Create a workspace', {
      body: 'A workspace holds your projects and members.',
      action: 'New workspace',
      centred: true,
    })
    await expect
      .poll(() => page.getByRole('button', { name: 'New workspace' }).elements().length)
      .toBe(1)
    expect(page.getByRole('button', { name: 'New project' }).elements()).toHaveLength(0)
  })

  it('explains that you need to ask when you can create nothing', async () => {
    fakeApi({
      'GET /api/projects': { body: { projects: [] } },
      'GET /api/capabilities': { body: caps() },
    })
    await show()
    await expectEmptyState('No workspace yet', { body: 'Ask an owner to add you to one.' })
    expect(page.getByRole('button', { name: /New/ }).elements()).toHaveLength(0)
  })

  it('tells a member of a workspace with no projects to ask for one, without a button', async () => {
    fakeApi({
      'GET /api/projects': { body: { projects: [] } },
      'GET /api/capabilities': { body: caps() },
    })
    await renderPage(<ProjectsPage />, { route: '/$workspace', url: '/acme', announcer: true })
    await expectEmptyState('No projects yet', { body: 'Ask an owner or admin to create one.' })
    expect(page.getByRole('button', { name: /New/ }).elements()).toHaveLength(0)
  })

  it('tells which sign-in methods a workspace accepts', async () => {
    fakeApi({
      'GET /api/projects': { body: { projects: [overview('acme', 'web')] } },
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

  describe('New workspace', () => {
    it('asks for a name and sends nothing without one', async () => {
      const api = await openWorkspaceDialog()
      await page.getByRole('button', { name: 'Create' }).click()
      await expect.element(page.getByText('Enter a name')).toBeVisible()
      expect(api.of('POST')).toHaveLength(0)
    })

    it('creates it, says so in a toast and closes', async () => {
      const api = await openWorkspaceDialog()
      await page.getByRole('textbox', { name: 'Name' }).fill('  Globex  ')
      await page.getByRole('button', { name: 'Create' }).click()
      await expect
        .element(page.getByRole('dialog', { name: 'New workspace' }))
        .not.toBeInTheDocument()
      expect(api.of('POST')).toMatchObject([
        { method: 'POST', path: '/api/workspaces', body: { name: 'Globex' } },
      ])
      await expect.element(toastNamed('Workspace Globex created')).toBeVisible()
    })

    it("shows the server's refusal and keeps the dialog open", async () => {
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
      await expect.poll(() => openDialogs()).toHaveLength(0)
      useOverlayStore.getState().setNewWorkspaceOpen(true)
      await userEvent.keyboard('{Escape}')
      await expect.poll(() => openDialogs()).toHaveLength(0)
    })
  })

  it('finds projects by name or address, keeps the text in the address and clears it with Esc', async () => {
    fakeApi({
      'GET /api/projects': {
        body: { projects: [overview('acme', 'web-app'), overview('acme', 'storybook')] },
      },
      'GET /api/capabilities': { body: caps() },
    })
    const { router } = await show()
    const list = page.getByRole('list', { name: 'Projects' })
    const find = page.getByRole('textbox', { name: 'Find projects' })
    await expect.element(find).toHaveAttribute('placeholder', 'Find projects')
    await userEvent.keyboard('/')
    await expect.element(find).toHaveFocus()
    await userEvent.type(find, 'story')
    await expect.element(list.getByText('acme/web-app')).not.toBeInTheDocument()
    await expect.element(list.getByText('acme/storybook')).toBeVisible()
    await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'story' }))
    // The count in the header is how many projects there are, not how many match.
    await expect.element(page.getByLabelText('2 projects')).toBeVisible()
    await userEvent.fill(find, 'acme/web')
    await expect.element(list.getByText('acme/web-app')).toBeVisible()
    await userEvent.fill(find, 'zzz')
    await expectEmptyState('No project matches “zzz”', { action: 'Clear search' })
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect.element(find).toHaveValue('')
    await userEvent.fill(find, 'zzz')
    await userEvent.keyboard('{Escape}')
    await expect.element(find).toHaveValue('')
    await expect.element(list.getByText('acme/storybook')).toBeVisible()
    await vi.waitFor(() => expect(router.state.location.search).not.toHaveProperty('q'))
  })
})

describe('ProjectsPage on a phone', () => {
  it('keeps the header one compact row with 36px buttons, the find field full width below it, and no sideways scroll', async () => {
    await page.viewport(390, 844)
    fakeApi({
      'GET /api/projects': {
        body: { projects: [overview('acme', 'web-app'), overview('acme', 'api')] },
      },
      'GET /api/capabilities': {
        body: caps({
          canCreateWorkspace: true,
          manageableWorkspaces: [{ slug: 'acme', name: 'Acme' }],
        }),
      },
    })
    await show()
    const create = page.getByRole('button', { name: 'New project' })
    await expect.element(create).toBeVisible()
    const header = pageHeader().getBoundingClientRect()
    expect(create.element().getBoundingClientRect().height).toBeLessThanOrEqual(36.5)
    expect(header.height).toBeLessThanOrEqual(52)
    const field = page
      .getByRole('textbox', { name: 'Find projects' })
      .element()
      .getBoundingClientRect()
    expect(field.top).toBeGreaterThanOrEqual(header.bottom - 1)
    expect(field.width).toBeGreaterThan(390 - 48)
    expectNoSidewaysScroll()
  })
})
