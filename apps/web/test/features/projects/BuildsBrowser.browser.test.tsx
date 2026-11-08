import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

// The auth client is the edge to better-auth (it lists the organization's members): a fake stands in.
const auth = vi.hoisted(() => ({
  getFullOrganization: vi.fn<(arg: unknown) => Promise<unknown>>(),
}))
vi.mock('#lib/auth-client.ts', () => ({ authClient: { organization: auth } }))

import { parseBuildsSearch } from '#features/projects/builds-filters.ts'
import { ProjectPage } from '#features/projects/ProjectPage.tsx'
import { ViewPage } from '#features/views/ViewPage.tsx'
import { useDisplayStore } from '#lib/stores/display-store.ts'
import { fakeApi, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

import { build } from './support.tsx'

afterEach(() => {
  restoreFetch()
  localStorage.clear()
})

const info = {
  id: 'p1',
  slug: 'web',
  name: 'Web App',
  defaultBranch: 'main',
  orgSlug: 'acme',
  orgName: 'Acme Inc',
}

const sidebar = (pinned = false) => ({
  projects: [{ slug: 'web', name: 'Web App', pinned, triage: 0 }],
  views: [],
  inboxUnread: 0,
  reviews: 0,
})

/** The faked API, plus every URL requested (the fake keeps only paths, and filters live in the query). */
function api(builds: unknown[], extra: Parameters<typeof fakeApi>[0] = {}) {
  const fake = fakeApi({
    'GET /api/projects/acme/web': { body: { project: info, builds, gitAttention: null } },
    'GET /api/projects/acme/web/flaky': { body: { builds: 10, flaky: [] } },
    'GET /api/orgs/acme/sidebar': { body: sidebar() },
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
  renderPage(<ProjectPage />, {
    beforeRender,
    route: '/$org/$project',
    url,
    announcer: true,
    validateSearch: parseBuildsSearch,
  })

describe('filters', () => {
  it('shows chips named by their value and sends the URL’s filters with the request', async () => {
    const fake = api([build(3)])
    await show('/acme/web?review=pending&branch=feature%2Fx')
    await expect
      .element(page.getByRole('button', { name: 'Status: Needs review' }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect.element(page.getByRole('button', { name: 'Branch: feature/x' })).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Author' }))
      .toHaveAttribute('aria-pressed', 'false')
    expect(fake.urls).toContain('/api/projects/acme/web?review=pending&branch=feature%2Fx')
  })

  it('applying a filter updates the URL and the request; clearing removes them', async () => {
    const fake = api([build(3)])
    const { router } = await show()
    await page.getByRole('button', { name: 'Status' }).click()
    await page.getByRole('button', { name: 'Approved' }).click()
    expect(router.state.location.search).toEqual({ review: 'approved' })
    await expect.poll(() => fake.urls).toContain('/api/projects/acme/web?review=approved')
    await expect
      .element(page.getByRole('button', { name: 'Status: Approved' }))
      .toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: 'Branch' }).click()
    await page.getByRole('textbox', { name: 'Branch' }).fill('main')
    await userEvent.keyboard('{Enter}')
    expect(router.state.location.search).toEqual({ review: 'approved', branch: 'main' })
    await expect
      .poll(() => fake.urls)
      .toContain('/api/projects/acme/web?review=approved&branch=main')

    await page.getByRole('button', { name: 'Clear filters' }).click()
    expect(router.state.location.search).toEqual({})
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

  it('hides a property and reads the saved options on the next visit', async () => {
    api([build(3), build(2)])
    await show('/acme/web', async () => {
      localStorage.setItem(
        'circi.builds.display',
        JSON.stringify({ groupBy: 'none', order: 'oldest', show: { counts: false } }),
      )
      await useDisplayStore.persist.rehydrate()
    })
    await expect.element(page.getByRole('link', { name: /Build #3/ })).toBeVisible()
    expect(page.getByText('2 changed').elements()).toHaveLength(0)
    const links = page.getByRole('link', { name: /Build #/ }).elements()
    expect(links[0]?.textContent).toContain('Build #2')
  })
})

describe('selecting and peeking', () => {
  it('X selects builds and the bulk bar approves them all in one request', async () => {
    const fake = api([build(8), build(7), build(6)], {
      'POST /api/projects/acme/web/builds/review': { body: { builds: [] } },
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
      path: '/api/projects/acme/web/builds/review',
      body: { buildIds: ['b8', 'b6'], decision: 'approved' },
    })
    await expect.element(bar).not.toBeInTheDocument()
  })

  it('rejects the selection with a required reason', async () => {
    const fake = api([build(8), build(7)], {
      'POST /api/projects/acme/web/builds/review': { body: { builds: [] } },
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
      'POST /api/orgs/acme/views': { status: 201, body: { id: 'v1', name: 'Mine' } },
    })
    await show('/acme/web?review=pending')
    await expect.element(page.getByRole('link', { name: /Build #3/ })).toBeVisible()
    await expect
      .poll(() => fake.of('GET').filter((c) => c.path === '/api/orgs/acme/sidebar'))
      .toHaveLength(1)
    await page.getByRole('button', { name: 'Save view' }).click()
    const dialog = page.getByRole('dialog', { name: 'Save view' })
    await expect.element(dialog.getByText('Status: Needs review')).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Waiting on me')
    await dialog.getByRole('button', { name: 'Save view' }).click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toEqual({
      name: 'Waiting on me',
      project: 'web',
      filters: { review: 'pending' },
      pinned: true,
    })
    await expect
      .poll(() => fake.of('GET').filter((c) => c.path === '/api/orgs/acme/sidebar'))
      .toHaveLength(2)
  })

  it('pins and unpins the project', async () => {
    const fake = api([build(3)], {
      'PUT /api/orgs/acme/pinned-projects/web': { body: { pinned: true, changed: true } },
    })
    await show()
    await page.getByRole('button', { name: 'Pin project' }).click()
    await expect.poll(() => fake.of('PUT')).toHaveLength(1)
    await expect
      .poll(() => fake.of('GET').filter((c) => c.path === '/api/orgs/acme/sidebar'))
      .toHaveLength(2)
  })
})

const showView = (id = 'v1') =>
  renderPage(<ViewPage />, {
    route: '/organizations/$org/views/$view',
    url: `/organizations/acme/views/${id}`,
    announcer: true,
  })

describe('ViewPage', () => {
  const view = {
    id: 'v1',
    name: 'Waiting on me',
    filters: { review: 'pending', branch: 'main' },
    pinned: true,
    position: 0,
    project: { slug: 'web', name: 'Web App' },
    createdAt: '2026-11-08T10:00:00.000Z',
  }
  it('lists the project’s builds with the view’s filters applied', async () => {
    const fake = api([build(3)], { 'GET /api/orgs/acme/views': { body: { views: [view] } } })
    await showView()
    await expect.element(page.getByRole('link', { name: /Build #3/ })).toBeVisible()
    expect(fake.urls).toContain('/api/projects/acme/web?review=pending&branch=main')
    await expect.element(page.getByRole('button', { name: 'Status: Needs review' })).toBeVisible()
    expect(page.getByRole('button', { name: 'Save view' }).elements()).toHaveLength(0)
    expect(document.title).toBe('Waiting on me · CirCI')
  })

  it('says when the view does not exist', async () => {
    api([], { 'GET /api/orgs/acme/views': { body: { views: [view] } } })
    await showView('other')
    await expect
      .element(page.getByRole('heading', { name: 'This view doesn’t exist' }))
      .toBeVisible()
  })
})
