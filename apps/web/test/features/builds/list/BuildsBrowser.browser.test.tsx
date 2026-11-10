import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it.
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { parseBuildsSearch } from '#features/builds/list/builds-filters.ts'
import { TeamPage } from '#features/teams/TeamPage.tsx'
import { ViewPage } from '#features/views/ViewPage.tsx'
import { useDisplayStore } from '#lib/stores/display-store.ts'
import { build } from '#test/features/teams/support.tsx'
import { mockAuthClient } from '#test/support/auth-client.ts'
import { fakeApi } from '#test/support/fetch.ts'
import { sidebarModel, sidebarTeam, teamInfo } from '#test/support/fixtures.ts'
import { renderPage } from '#test/support/render.tsx'

const auth = mockAuthClient().organization

const info = teamInfo()

const sidebar = (pinned = false) => sidebarModel({ teams: [sidebarTeam({ pinned })] })

/** The faked API, plus every URL requested (the fake keeps only paths, and filters live in the query). */
function api(builds: unknown[], extra: Parameters<typeof fakeApi>[0] = {}) {
  const fake = fakeApi({
    'GET /api/teams/acme/web': { body: { team: info, builds, gitAttention: null } },
    'GET /api/teams/acme/web/flaky': { body: { builds: 10, flaky: [] } },
    'GET /api/workspaces/acme/sidebar': { body: sidebar() },
    ...extra,
  })
  const urls: string[] = []
  const inner = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(input instanceof Request ? input.url : String(input))
    return inner(input, init)
  })
  return { ...fake, urls }
}

const show = (url = '/acme/web', beforeRender?: () => Promise<void>) =>
  renderPage(<TeamPage />, {
    beforeRender,
    route: '/$workspace/$team',
    url,
    announcer: true,
    validateSearch: parseBuildsSearch,
  })

describe('filters', () => {
  it("shows chips named by their value and sends the URL's filters with the request", async () => {
    const fake = api([build(3)])
    await show('/acme/web?review=pending&branch=feature%2Fx')
    await expect
      .element(page.getByRole('button', { name: 'Status: Needs review' }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect.element(page.getByRole('button', { name: 'Branch: feature/x' })).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Author' }))
      .toHaveAttribute('aria-pressed', 'false')
    expect(fake.urls).toContain('/api/teams/acme/web?review=pending&branch=feature%2Fx')
  })

  it('applying a filter updates the URL and the request; clearing removes them', async () => {
    const fake = api([build(3)])
    const { router } = await show()
    await page.getByRole('button', { name: 'Status' }).click()
    await page.getByRole('button', { name: 'Approved' }).click()
    expect(router.state.location.search).toEqual({ review: 'approved' })
    await expect.poll(() => fake.urls).toContain('/api/teams/acme/web?review=approved')
    await expect
      .element(page.getByRole('button', { name: 'Status: Approved' }))
      .toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: 'Branch' }).click()
    await page.getByRole('combobox', { name: 'Branch' }).fill('main')
    await userEvent.keyboard('{Enter}')
    expect(router.state.location.search).toEqual({ review: 'approved', branchContains: 'main' })
    await expect
      .poll(() => fake.urls)
      .toContain('/api/teams/acme/web?review=approved&branchContains=main')

    await page.getByRole('button', { name: 'Clear filters' }).click()
    expect(router.state.location.search).toEqual({})
  })

  describe('the branch picker', () => {
    const branches = {
      'GET /api/workspaces/acme/builds/branches': {
        body: {
          branches: [
            { name: 'main', lastBuildAt: '2026-11-08T10:00:00.000Z' },
            { name: 'qa/pr20', lastBuildAt: '2026-11-07T10:00:00.000Z' },
            { name: 'feature/login', lastBuildAt: '2026-11-06T10:00:00.000Z' },
          ],
        },
      },
    }

    it("lists the team's branches in the order given, and asks the server as you type", async () => {
      const fake = api([build(3)], branches)
      await show()
      await page.getByRole('button', { name: 'Branch' }).click()
      const options = page.getByRole('option')
      await expect.element(options.first()).toHaveTextContent('main')
      expect(options.elements().map((o) => o.textContent)).toEqual([
        'main',
        'qa/pr20',
        'feature/login',
      ])
      expect(fake.urls).toContain('/api/workspaces/acme/builds/branches?q=&team=web')
      await page.getByRole('combobox', { name: 'Branch' }).fill('QA')
      await expect
        .poll(() => fake.urls)
        .toContain('/api/workspaces/acme/builds/branches?q=QA&team=web')
    })

    it('filters to exactly the branch picked, with the mouse', async () => {
      const fake = api([build(3)], branches)
      const { router } = await show()
      await page.getByRole('button', { name: 'Branch' }).click()
      await page.getByRole('option', { name: 'qa/pr20' }).click()
      expect(router.state.location.search).toEqual({ branch: 'qa/pr20' })
      await expect.poll(() => fake.urls).toContain('/api/teams/acme/web?branch=qa%2Fpr20')
      await expect.element(page.getByRole('button', { name: 'Branch: qa/pr20' })).toBeVisible()
    })

    it('picks with the arrow keys and Enter', async () => {
      api([build(3)], branches)
      const { router } = await show()
      await page.getByRole('button', { name: 'Branch' }).click()
      await expect.element(page.getByRole('option', { name: 'main' })).toBeVisible()
      await page.getByRole('combobox', { name: 'Branch' }).click()
      await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
      expect(router.state.location.search).toEqual({ branch: 'qa/pr20' })
    })

    it('filters by names containing free text that is not a branch, and shows it on the chip', async () => {
      const fake = api([build(3)], branches)
      const { router } = await show()
      await page.getByRole('button', { name: 'Branch' }).click()
      await page.getByRole('combobox', { name: 'Branch' }).fill('pr2')
      await userEvent.keyboard('{Enter}')
      expect(router.state.location.search).toEqual({ branchContains: 'pr2' })
      await expect.poll(() => fake.urls).toContain('/api/teams/acme/web?branchContains=pr2')
      await expect.element(page.getByRole('button', { name: 'Branch: contains pr2' })).toBeVisible()
    })

    it('treats text typed exactly as a listed branch as that branch', async () => {
      api([build(3)], branches)
      const { router } = await show()
      await page.getByRole('button', { name: 'Branch' }).click()
      await expect.element(page.getByRole('option', { name: 'main' })).toBeVisible()
      await page.getByRole('combobox', { name: 'Branch' }).fill('main')
      await userEvent.keyboard('{Enter}')
      expect(router.state.location.search).toEqual({ branch: 'main' })
    })
  })

  it('says no builds match, and clears the filters from there', async () => {
    api([])
    const { router } = await show('/acme/web?branch=nope')
    await expect.element(page.getByRole('heading', { name: 'No builds match' })).toBeVisible()
    expect(page.getByText(/npx circi upload/).elements()).toHaveLength(0)
    await page.getByRole('button', { name: 'Clear filters' }).last().click()
    expect(router.state.location.search).toEqual({})
  })

  it('opens the status filter with F and the display options with ⇧V', async () => {
    api([build(3)])
    await show()
    await expect.element(page.getByRole('link', { name: /Build #3/ })).toBeVisible()
    await userEvent.keyboard('f')
    await expect.element(page.getByRole('dialog', { name: 'Filter by status' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect
      .element(page.getByRole('dialog', { name: 'Filter by status' }))
      .not.toBeInTheDocument()
    await userEvent.keyboard('{Shift>}v{/Shift}')
    await expect.element(page.getByRole('dialog', { name: 'Display options' })).toBeVisible()
  })
})

describe('display options', () => {
  it('groups the list and remembers the choice for next time', async () => {
    api([build(3, { branch: 'main' }), build(2, { branch: 'dev' }), build(1, { branch: 'main' })])
    await show()
    await page.getByRole('button', { name: 'Display' }).click()
    await page
      .getByRole('dialog', { name: 'Display options' })
      .getByRole('button', { name: 'Branch' })
      .click()
    await expect.element(page.getByRole('heading', { name: 'dev' })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: 'main' })).toBeVisible()
    expect(localStorage.getItem('circi.builds.display')).toContain('"groupBy":"branch"')
  })

  it('asks the server for the chosen order and remembers it', async () => {
    const fake = api([build(3), build(2)])
    await show()
    await expect.element(page.getByRole('link', { name: /Build #3/ })).toBeVisible()
    expect(fake.urls.some((u) => u.includes('order='))).toBe(false)
    await page.getByRole('button', { name: 'Display' }).click()
    await page
      .getByRole('dialog', { name: 'Display options' })
      .getByRole('button', { name: 'Most changes' })
      .click()
    await expect.poll(() => fake.urls.some((u) => u.includes('order=most-changes'))).toBe(true)
    expect(localStorage.getItem('circi.builds.display')).toContain('"order":"most-changes"')
  })

  it('hides a property and reads the saved options on the next visit', async () => {
    const fake = api([build(3), build(2)])
    await show('/acme/web', async () => {
      localStorage.setItem(
        'circi.builds.display',
        JSON.stringify({ groupBy: 'none', order: 'oldest', show: { counts: false } }),
      )
      await useDisplayStore.persist.rehydrate()
    })
    await expect.element(page.getByRole('link', { name: /Build #3/ })).toBeVisible()
    expect(page.getByText('2 changed').elements()).toHaveLength(0)
    // The server orders the list: the saved order is asked for, and the rows keep its sequence.
    await expect.poll(() => fake.urls.length).toBeGreaterThan(0)
    const links = page.getByRole('link', { name: /Build #/ }).elements()
    expect(links[0]?.textContent).toContain('Build #3')
    expect(fake.urls.some((u) => u.includes('order=oldest'))).toBe(true)
  })
})

describe('selecting and peeking', () => {
  it('X selects builds and the bulk bar approves them all in one request', async () => {
    const fake = api([build(8), build(7), build(6)], {
      'POST /api/teams/acme/web/builds/review': { body: { builds: [] } },
    })
    await show()
    await expect.element(page.getByRole('link', { name: /Build #8/ })).toBeVisible()
    expect(page.getByRole('region', { name: 'Bulk actions' }).elements()).toHaveLength(0)
    await userEvent.keyboard('x')
    await userEvent.keyboard('j')
    await userEvent.keyboard('j')
    await userEvent.keyboard('x')
    const bar = page.getByRole('region', { name: 'Bulk actions' })
    await expect.element(bar.getByText('2 selected')).toBeVisible()
    await expect.element(page.getByRole('link', { name: /Selected, Build #8/ })).toBeVisible()
    await bar.getByRole('button', { name: 'Approve' }).click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]).toMatchObject({
      path: '/api/teams/acme/web/builds/review',
      body: { buildIds: ['b8', 'b6'], decision: 'approved' },
    })
    await expect.element(bar).not.toBeInTheDocument()
  })

  it('requests a review of the selection with one request', async () => {
    auth.getFullOrganization.mockResolvedValue({
      data: {
        id: 'o1',
        name: 'Acme',
        slug: 'acme',
        members: [
          {
            id: 'm1',
            userId: 'u1',
            role: 'owner',
            user: { name: 'Ada Lovelace', email: 'a@x.test' },
          },
          {
            id: 'm2',
            userId: 'u2',
            role: 'member',
            user: { name: 'Grace Hopper', email: 'g@x.test' },
          },
        ],
        invitations: [],
      },
      error: null,
    })
    const fake = api([build(8), build(7), build(6)], {
      'POST /api/teams/acme/web/builds/request-review': { body: { requests: [] } },
    })
    await show()
    await expect.element(page.getByRole('link', { name: /Build #8/ })).toBeVisible()
    await userEvent.keyboard('x')
    await userEvent.keyboard('j')
    await userEvent.keyboard('j')
    await userEvent.keyboard('x')
    await page.getByRole('button', { name: 'Request review' }).click()
    // Ada is the signed-in user: she is not one of the choices.
    await page.getByRole('dialog').getByText('Grace Hopper').click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]).toMatchObject({
      path: '/api/teams/acme/web/builds/request-review',
      body: { buildIds: ['b8', 'b6'], reviewerIds: ['u2'] },
    })
  })

  it('rejects the selection with a required reason', async () => {
    const fake = api([build(8), build(7)], {
      'POST /api/teams/acme/web/builds/review': { body: { builds: [] } },
    })
    await show()
    await expect.element(page.getByRole('link', { name: /Build #8/ })).toBeVisible()
    await userEvent.keyboard('x')
    await page.getByRole('button', { name: 'Reject' }).click()
    const dialog = page.getByRole('dialog', { name: 'Reject 1 build?' })
    await dialog.getByRole('button', { name: 'Reject' }).click()
    await expect.element(dialog.getByText('Say why you are rejecting them.')).toBeVisible()
    expect(fake.of('POST')).toHaveLength(0)
    await dialog.getByRole('textbox', { name: 'Reason' }).fill('Header is clipped')
    await dialog.getByRole('button', { name: 'Reject' }).click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toEqual({
      buildIds: ['b8'],
      decision: 'rejected',
      reason: 'Header is clipped',
    })
  })

  it('Space peeks at the focused build and again hides it', async () => {
    api([build(8, { branch: 'feature/peek' }), build(7)])
    await show()
    await expect.element(page.getByRole('link', { name: /Build #8/ })).toBeVisible()
    await userEvent.keyboard('j')
    await userEvent.keyboard(' ')
    const pane = page.getByRole('region', { name: 'Preview' })
    await expect.element(pane).toBeVisible()
    await expect.element(pane.getByText('#7')).toBeVisible()
    await expect
      .element(pane.getByRole('link', { name: 'Open build' }))
      .toHaveAttribute('href', '/acme/web/builds/7')
    await userEvent.keyboard(' ')
    await expect.element(pane).not.toBeInTheDocument()
  })
})

describe('saving a view and pinning', () => {
  it('names the filters, saves them as a pinned view and refreshes the sidebar', async () => {
    const fake = api([build(3)], {
      'POST /api/workspaces/acme/views': { status: 201, body: { id: 'v1', name: 'Mine' } },
    })
    await show('/acme/web?review=pending')
    await expect.element(page.getByRole('link', { name: /Build #3/ })).toBeVisible()
    await expect
      .poll(() => fake.of('GET').filter((c) => c.path === '/api/workspaces/acme/sidebar'))
      .toHaveLength(1)
    await page.getByRole('button', { name: 'Save view' }).click()
    const dialog = page.getByRole('dialog', { name: 'Save view' })
    await expect.element(dialog.getByText('Status: Needs review')).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Waiting on me')
    await dialog.getByRole('button', { name: 'Save view' }).click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toEqual({
      name: 'Waiting on me',
      team: 'web',
      filters: { review: 'pending' },
      pinned: true,
    })
    await expect
      .poll(() => fake.of('GET').filter((c) => c.path === '/api/workspaces/acme/sidebar'))
      .toHaveLength(2)
  })

  it('once the filters equal a saved view, Save view gives way to "Saved as …"', async () => {
    const saved = {
      id: 'v1',
      name: 'QA rejected',
      filters: { review: 'rejected' },
      pinned: true,
      position: 0,
      team: { slug: 'web', name: 'Web App' },
      createdAt: '2026-11-08T10:00:00.000Z',
    }
    let created = false
    api([build(3)], {
      'GET /api/workspaces/acme/views': () => ({ body: { views: created ? [saved] : [] } }),
      'POST /api/workspaces/acme/views': () => {
        created = true
        return { status: 201, body: saved }
      },
    })
    await show('/acme/web?review=rejected')
    await expect.element(page.getByRole('link', { name: /Build #3/ })).toBeVisible()
    await page.getByRole('button', { name: 'Save view' }).click()
    const dialog = page.getByRole('dialog', { name: 'Save view' })
    await dialog.getByRole('textbox', { name: 'Name' }).fill('QA rejected')
    await dialog.getByRole('button', { name: 'Save view' }).click()
    await expect.element(page.getByText('Saved as QA rejected')).toBeVisible()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(page.getByRole('button', { name: 'Save view' }).elements()).toHaveLength(0)
  })

  it("still offers Save view when only a different team's view has the same filters", async () => {
    api([build(3)], {
      'GET /api/workspaces/acme/views': {
        body: {
          views: [
            {
              id: 'v2',
              name: 'Elsewhere',
              filters: { review: 'rejected' },
              pinned: true,
              position: 0,
              team: { slug: 'docs', name: 'Docs' },
              createdAt: '2026-11-08T10:00:00.000Z',
            },
          ],
        },
      },
    })
    await show('/acme/web?review=rejected')
    await expect.element(page.getByRole('button', { name: 'Save view' })).toBeVisible()
  })

  it('pins and unpins the team', async () => {
    const fake = api([build(3)], {
      'PUT /api/workspaces/acme/pinned-teams/web': { body: { pinned: true, changed: true } },
    })
    await show()
    await page.getByRole('button', { name: 'Pin team' }).click()
    await expect.poll(() => fake.of('PUT')).toHaveLength(1)
    await expect
      .poll(() => fake.of('GET').filter((c) => c.path === '/api/workspaces/acme/sidebar'))
      .toHaveLength(2)
  })
})

/** A build of the workspace-wide list: the usual item and its team. */
const row = (n: number, team: string) => ({
  ...build(n),
  team: { slug: team, name: team.toUpperCase() },
})

const showView = (id = 'v1') =>
  renderPage(<ViewPage />, {
    route: '/workspaces/$workspace/views/$view',
    url: `/workspaces/acme/views/${id}`,
    announcer: true,
  })

describe('ViewPage', () => {
  const view = {
    id: 'v1',
    name: 'Waiting on me',
    filters: { review: 'pending', branch: 'main' },
    pinned: true,
    position: 0,
    team: { slug: 'web', name: 'Web App' },
    createdAt: '2026-11-08T10:00:00.000Z',
  }
  it("lists the team's builds with the view's filters applied", async () => {
    const fake = api([build(3)], { 'GET /api/workspaces/acme/views': { body: { views: [view] } } })
    await showView()
    await expect.element(page.getByRole('link', { name: /Build #3/ })).toBeVisible()
    expect(fake.urls).toContain('/api/teams/acme/web?review=pending&branch=main')
    await expect.element(page.getByRole('button', { name: 'Status: Needs review' })).toBeVisible()
    expect(page.getByRole('button', { name: 'Save view' }).elements()).toHaveLength(0)
    expect(document.title).toBe('Waiting on me · CirCI')
  })

  it("lists every team's builds for a view with no team, and pages with a cursor", async () => {
    const wide = { ...view, filters: { review: 'pending' }, team: null }
    const urls: string[] = []
    const fake = fakeApi({
      'GET /api/workspaces/acme/views': { body: { views: [wide] } },
      'GET /api/workspaces/acme/builds': {
        body: {
          workspace: { slug: 'acme', name: 'Acme Inc' },
          builds: [row(9, 'docs'), row(8, 'web')],
          next: 'cursor-1',
        },
      },
      'GET /api/workspaces/acme/sidebar': { body: sidebar() },
    })
    const inner = globalThis.fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(input instanceof Request ? input.url : String(input))
      return inner(input, init)
    })
    await showView()
    const docs = page.getByRole('link', { name: /Build #9/ })
    await expect.element(docs).toBeVisible()
    expect(docs.element().getAttribute('href')).toBe('/acme/docs/builds/9')
    expect(
      page
        .getByRole('link', { name: /Build #8/ })
        .element()
        .getAttribute('href'),
    ).toBe('/acme/web/builds/8')
    await expect.element(page.getByText('DOCS')).toBeVisible()
    expect(urls).toContain('/api/workspaces/acme/builds?review=pending')
    await page.getByRole('button', { name: 'Older builds' }).click()
    await expect
      .poll(() => urls)
      .toContain('/api/workspaces/acme/builds?review=pending&before=cursor-1')
    // Bulk selection belongs to one team, so X selects nothing here.
    await userEvent.keyboard('x')
    expect(page.getByRole('region', { name: 'Bulk actions' }).elements()).toHaveLength(0)
    expect(fake.of('POST')).toHaveLength(0)
  })

  it('offers members as suggestions on the author chip, and shows the name once picked', async () => {
    auth.getFullOrganization.mockResolvedValue({
      data: {
        id: 'o1',
        name: 'Acme',
        slug: 'acme',
        members: [
          {
            id: 'm1',
            userId: 'u1',
            role: 'owner',
            user: { name: 'Ada Lovelace', email: 'a@x.test' },
          },
        ],
        invitations: [],
      },
      error: null,
    })
    const wide = { ...view, filters: {}, team: null }
    const asked: string[] = []
    fakeApi({
      'GET /api/workspaces/acme/views': { body: { views: [wide] } },
      'GET /api/workspaces/acme/builds': {
        body: {
          workspace: { slug: 'acme', name: 'Acme Inc' },
          builds: [{ ...build(9), team: { slug: 'docs', name: 'Docs' } }],
          next: null,
        },
      },
      'GET /api/workspaces/acme/builds/suggestions': {
        body: {
          suggestions: [
            { value: 'u1', label: 'Ada Lovelace', kind: 'member' },
            { value: 'octocat', label: 'octocat', kind: 'login' },
          ],
        },
      },
      'GET /api/workspaces/acme/sidebar': { body: sidebar() },
    })
    const inner = globalThis.fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push(input instanceof Request ? input.url : String(input))
      return inner(input, init)
    })
    await showView()
    await page.getByRole('button', { name: 'Author' }).click()
    const list = page.getByRole('list', { name: 'Suggestions' })
    await expect.element(list.getByRole('button', { name: 'octocat' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Author' }).fill('ada')
    await expect
      .poll(() => asked.some((u) => u.includes('field=author') && u.includes('q=ada')))
      .toBe(true)
    await list.getByRole('button', { name: 'Ada Lovelace' }).click()
    await expect.element(page.getByRole('button', { name: 'Author: Ada Lovelace' })).toBeVisible()
    await expect.poll(() => asked.some((u) => u.includes('builds?author=u1'))).toBe(true)
  })

  it('says when the view does not exist', async () => {
    api([], { 'GET /api/workspaces/acme/views': { body: { views: [view] } } })
    await showView('other')
    await expect
      .element(page.getByRole('heading', { name: "This view doesn't exist" }))
      .toBeVisible()
  })
})
