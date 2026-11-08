import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { TeamPage } from '#features/teams/TeamPage.tsx'
import { fakeApi, hangingFetch, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

import { build } from './support.tsx'

afterEach(() => restoreFetch())

const info = {
  id: 'p1',
  slug: 'web',
  name: 'Web App',
  defaultBranch: 'main',
  workspaceSlug: 'acme',
  workspaceName: 'Acme Inc',
}

function api(
  builds: unknown[],
  flaky: unknown = { builds: 10, flaky: [] },
  gitAttention: unknown = null,
) {
  return fakeApi({
    'GET /api/teams/acme/web': { body: { team: info, builds, gitAttention } },
    'GET /api/teams/acme/web/flaky': { body: flaky },
  })
}

const show = (url = '/acme/web') =>
  renderPage(<TeamPage />, { route: '/$workspace/$team', url: url, announcer: true })

describe('TeamPage', () => {
  it('shows the breadcrumb at once from the URL and no list while loading', async () => {
    hangingFetch()
    await show()
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect.poll(() => crumbs.element().textContent).toBe('Teamsacmeweb')
    await expect.element(page.getByText('web', { exact: true })).toBeVisible()
    expect(page.getByRole('list', { name: 'Builds' }).elements()).toHaveLength(0)
    await expect.element(page.getByRole('status').first()).toHaveTextContent('Loading builds', {
      timeout: 2_000,
    })
  })

  it('names the team and its workspace once loaded, and says what the default branch is for', async () => {
    api([build(3)])
    await show()
    await expect
      .element(page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('Web App'))
      .toBeVisible()
    await expect.element(page.getByText('Acme Inc')).toBeVisible()
    await expect.element(page.getByRole('link', { name: 'Teams' })).toHaveAttribute('href', '/')
    await expect.element(page.getByRole('button', { name: 'Copy default branch' })).toBeVisible()
    await expect
      .element(page.getByText(/become the baselines that pull requests are compared with/))
      .toBeVisible()
    expect(document.title).toBe('Builds · Web App · CirCI')
  })

  it('warns when GitHub no longer accepts the team’s installation, and says nothing otherwise', async () => {
    api([build(3)])
    await show()
    await expect.element(page.getByText('Web App', { exact: true }).first()).toBeVisible()
    expect(page.getByText(/can’t reach GitHub/).elements()).toHaveLength(0)
    restoreFetch()

    api([build(3)], undefined, { reason: 'installation_revoked', since: new Date().toISOString() })
    await show()
    const banner = page.getByRole('alert')
    await expect.element(banner.getByText(/reach GitHub for this team/)).toBeVisible()
    await expect.element(banner.getByText(/GitHub App was removed or suspended/)).toBeVisible()
    await expect.element(banner.getByText(/Reinstall/)).toBeVisible()
  })

  it('lists builds as rows linking to each build, with status, name, meta and counts', async () => {
    api([
      build(8, {
        name: 'mobile',
        prNumber: 4,
        branch: 'feature/y',
        counts: { added: 1, removed: 0, changed: 0, unchanged: 0, failed: 2, total: 3 },
      }),
      build(7, { reviewStatus: 'approved' }),
      build(6, {
        conclusion: 'no_changes',
        counts: { added: 0, removed: 0, changed: 0, unchanged: 5, failed: 0, total: 5 },
      }),
      build(5, { status: 'error' }),
    ])
    await show()
    const list = page.getByRole('list', { name: 'Builds' })
    await expect.element(list).toBeVisible()
    expect(page.getByRole('listitem').elements().length).toBeGreaterThanOrEqual(4)
    const link = page.getByRole('link', { name: /Build #8/ })
    await expect.element(link).toHaveAttribute('href', '/acme/web/builds/8')
    expect(link.element().textContent).toContain('Build #8 · mobile')
    await expect.element(page.getByText('PR #4')).toBeVisible()
    await expect.element(page.getByText('feature/y')).toBeVisible()
    await expect.element(page.getByText('2 failed')).toBeVisible()
    await expect.element(page.getByText('1 added')).toBeVisible()
    // The default build name isn't repeated.
    await expect.element(page.getByRole('link', { name: /Build #7/ })).toBeVisible()
    // Each build's state is a named glyph.
    await expect.element(page.getByRole('img', { name: 'Needs review' }).first()).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Approved' }).first()).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'No changes' }).first()).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Failed' }).first()).toBeVisible()
    await expect.element(page.getByText('No screenshots')).not.toBeInTheDocument()
  })

  it.each([
    ['pending', 'needs-review'],
    ['approved', 'approved'],
    ['rejected', 'rejected'],
  ] as const)('a %s build’s count chips show the %s glyph', async (reviewStatus, glyph) => {
    api([
      build(4, {
        reviewStatus,
        counts: { added: 1, removed: 1, changed: 2, unchanged: 3, failed: 1, total: 8 },
      }),
    ])
    await show()
    await expect.element(page.getByText('2 changed')).toBeVisible()
    for (const text of ['2 changed', '1 added', '1 removed']) {
      const chip = page.getByText(text).element()
      expect(chip.textContent).toBe(text)
      expect(chip.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
      // Pending added and removed have their own glyphs; decided ones follow the review.
      const own =
        reviewStatus === 'pending'
          ? { '1 added': 'added', '1 removed': 'removed' }[text]
          : undefined
      expect(chip.querySelector('svg')?.getAttribute('data-status')).toBe(own ?? glyph)
    }
    expect(
      page.getByText('1 failed').element().querySelector('svg')?.getAttribute('data-status'),
    ).toBe('rejected')
  })

  it('says a build has no screenshots', async () => {
    api([
      build(1, { counts: { added: 0, removed: 0, changed: 0, unchanged: 0, failed: 0, total: 0 } }),
    ])
    await show()
    await expect.element(page.getByText('No screenshots')).toBeVisible()
  })

  it('goes to a build when its row is clicked', async () => {
    api([build(8)])
    const { router } = await show()
    await page.getByRole('link', { name: /Build #8/ }).click()
    expect(router.state.location.pathname).toBe('/acme/web/builds/8')
  })

  it('opens Sites and Settings from the header', async () => {
    api([build(8)])
    const { router } = await show()
    // They go somewhere, so they are links (with real addresses), not buttons.
    await expect
      .element(page.getByRole('link', { name: 'Sites' }))
      .toHaveAttribute('href', '/acme/web/sites')
    await page.getByRole('link', { name: 'Settings' }).click()
    expect(router.state.location.pathname).toBe('/acme/web/settings')
  })

  it('guides the first upload when there are no builds', async () => {
    api([])
    await show()
    await expect.element(page.getByRole('heading', { name: 'No builds yet' })).toBeVisible()
    await expect.element(page.getByText(/npx circi upload \.\/screenshots --wait/)).toBeVisible()
    await expect.element(page.getByText(/CIRCI_TOKEN=…/)).toBeVisible()
  })

  it('warns about flaky screenshots on the default branch', async () => {
    api([build(8)], {
      builds: 10,
      flaky: [
        { name: 'clock', changedIn: 6 },
        { name: 'ticker', changedIn: 4 },
      ],
    })
    await show()
    const banner = page.getByRole('status').filter({ hasText: 'keep changing' })
    await expect.element(banner).toBeVisible()
    await expect
      .poll(() => banner.element().textContent)
      .toMatch(/clock \(6 of the last 10 builds\), ticker \(4 of the last 10 builds\)/)
    await expect.poll(() => banner.element().textContent).toMatch(/circi admin ignore add/)
  })

  it('pages back through older builds and returns to the newest', async () => {
    const full = Array.from({ length: 50 }, (_, i) => build(100 - i))
    const fake = api(full)
    const { router } = await show()
    await page.getByRole('link', { name: 'Older builds' }).click()
    expect(router.state.location.search).toEqual({ before: 51 })
    await expect.element(page.getByRole('heading', { name: 'Older builds' })).toBeVisible()
    expect(fake.of('GET').some((c) => c.path === '/api/teams/acme/web')).toBe(true)
    await expect.element(page.getByRole('link', { name: 'Newest builds' })).toBeVisible()
    await page.getByRole('link', { name: 'Newest builds' }).click()
    expect(router.state.location.search).toEqual({})
  })

  it('shows no pager for a short list', async () => {
    api([build(2), build(1)])
    await show()
    await expect.element(page.getByRole('link', { name: /Build #2/ })).toBeVisible()
    expect(page.getByRole('button', { name: /builds$/ }).elements()).toHaveLength(0)
  })

  it('says "No older builds" past the end', async () => {
    api([])
    await renderPage(<TeamPage />, {
      route: '/$workspace/$team',
      url: '/acme/web?before=3',
      announcer: true,
    })
    await expect.element(page.getByRole('heading', { name: 'No older builds' })).toBeVisible()
    expect(page.getByText(/npx circi upload/).elements()).toHaveLength(0)
  })

  it('says the team doesn’t exist for a 404', async () => {
    fakeApi({
      'GET /api/teams/acme/web': { status: 404, body: { error: 'Team not found' } },
      'GET /api/teams/acme/web/flaky': { status: 404, body: { error: 'Team not found' } },
    })
    await show()
    await expect
      .element(page.getByRole('heading', { name: 'This team doesn’t exist' }))
      .toBeVisible()
    expect(page.getByRole('button', { name: 'Try again' }).elements()).toHaveLength(0)
  })

  it('shows other errors and retries', async () => {
    const fake = api([build(1)])
    fake.set('GET /api/teams/acme/web', { status: 500, body: { error: 'database is down' } })
    await show()
    await expect.element(page.getByText('database is down')).toBeVisible()
    fake.set('GET /api/teams/acme/web', { body: { team: info, builds: [build(1)] } })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.element(page.getByRole('link', { name: /Build #1/ })).toBeVisible()
  })
})

describe('TeamPage route search', () => {
  it('reads the page cursor from the URL', async () => {
    const fake = api([build(2)])
    await renderPage(<TeamPage />, {
      route: '/$workspace/$team',
      url: '/acme/web?before=40',
      announcer: true,
    })
    await expect.element(page.getByRole('heading', { name: 'Older builds' })).toBeVisible()
    expect(fake.calls.some((c) => c.path === '/api/teams/acme/web')).toBe(true)
  })
})
