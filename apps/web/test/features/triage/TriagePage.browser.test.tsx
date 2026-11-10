import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake signs Ada in.
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { TriagePage } from '#features/triage/TriagePage.tsx'
import { fakeApi, fakeFetch, pending, type ReplyHandler } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const BASE = '/api/teams/acme/web'

const item = (key: string, over: Record<string, unknown> = {}) => ({
  kind: 'flaky',
  key,
  snapshotName: key,
  team: { slug: 'web', name: 'Web' },
  build: {
    number: 12,
    branch: 'main',
    commitSha: 'abcdef1',
    status: 'complete',
    createdAt: '2026-11-08T10:00:00.000Z',
  },
  assignee: null,
  snoozedUntil: null,
  snoozeKind: null,
  snoozed: false,
  ...over,
})

const queue = (items: unknown[], onTriage: { id: string; name: string } | null = null) => ({
  items,
  rotation: {
    members: onTriage ? [onTriage] : [],
    onTriage,
    until: onTriage ? '2026-11-15T00:00:00.000Z' : null,
  },
})

const history = {
  defaultBranch: 'main',
  default: [
    {
      build: {
        number: 12,
        branch: 'main',
        status: 'complete',
        reviewStatus: 'pending',
        createdAt: '2026-11-08T10:00:00.000Z',
      },
      status: 'changed',
      image: { sha256: 'abc', thumbnail: 'abc-t', width: 400, height: 300 },
    },
    {
      build: {
        number: 11,
        branch: 'main',
        status: 'complete',
        reviewStatus: 'approved',
        createdAt: '2026-11-07T10:00:00.000Z',
      },
      status: 'unchanged',
      image: { sha256: 'abd', thumbnail: null, width: 400, height: 300 },
    },
  ],
  branch: null,
}

const show = () =>
  renderPage(<TriagePage />, {
    route: '/$workspace/$team/triage',
    url: '/acme/web/triage',
    otherRoutes: ['/$workspace/$team/builds/$number'],
    announcer: true,
  })

const items = () => [
  item('home'),
  item('pricing', { kind: 'no_baseline' }),
  item('build:9', { kind: 'failed', snapshotName: null }),
]

/** A server whose queue loses an item once it is acted on, as the real one does. */
const field = (body: unknown, key: string): unknown =>
  typeof body === 'object' && body !== null ? Reflect.get(body, key) : undefined

function server() {
  let current = items()
  const gone = (key: unknown) => {
    current = current.filter((i) => i.key !== key)
    return { body: {} }
  }
  const routes: Record<string, ReplyHandler> = {
    [`GET ${BASE}/triage`]: () => ({ body: queue(current) }),
    [`GET ${BASE}/snapshots/home/history`]: { body: history },
    [`GET ${BASE}/snapshots/pricing/history`]: { body: { ...history, default: [] } },
    [`POST ${BASE}/triage/dismiss`]: (body) => gone(field(body, 'key')),
    [`POST ${BASE}/triage/snooze`]: (body) => gone(field(body, 'key')),
    [`POST ${BASE}/triage/assign`]: { body: {} },
  }
  return fakeApi(routes)
}

describe('TriagePage', () => {
  it('groups the queue under labelled lists with counts and names rows by kind and snapshot', async () => {
    server()
    await show()
    await expect.element(page.getByRole('heading', { name: /^Flaky/ })).toBeVisible()
    await expect.element(page.getByRole('list', { name: 'Flaky, 1 item' })).toBeVisible()
    await expect.element(page.getByRole('list', { name: 'No baseline, 1 item' })).toBeVisible()
    await expect.element(page.getByRole('list', { name: 'Failed, 1 item' })).toBeVisible()
    await expect.element(page.getByText('Flaky, home, build #12, main.')).toBeInTheDocument()
    await expect.element(page.getByRole('status').getByText('3 items to triage')).toBeVisible()
  })

  it('shows the filmstrip of the selected snapshot with the flaky glyph', async () => {
    server()
    await show()
    const strip = page.getByRole('list', { name: 'Recent builds of home' })
    await expect.element(strip).toBeVisible()
    await expect.element(strip.getByRole('img', { name: 'Flaky' })).toBeVisible()
    expect(strip.getByRole('listitem').elements()).toHaveLength(2)
  })

  it('reads the filmstrip with one history request, not one per build', async () => {
    const api = server()
    await show()
    await expect.element(page.getByRole('list', { name: 'Recent builds of home' })).toBeVisible()
    const paths = api.of('GET').map((c) => c.path)
    expect(paths.filter((p) => p.includes('/snapshots/'))).toEqual([
      `${BASE}/snapshots/home/history`,
    ])
    expect(paths.some((p) => p.includes('/builds/'))).toBe(false)
  })

  it('shows who is on triage this week', async () => {
    fakeApi({
      [`GET ${BASE}/triage`]: { body: queue([item('home')], { id: 'u2', name: 'Grace Hopper' }) },
    })
    await show()
    await expect.element(page.getByLabelText('On triage: Grace Hopper')).toBeVisible()
  })

  it('says there is nothing to triage', async () => {
    fakeApi({ [`GET ${BASE}/triage`]: { body: queue([]) } })
    await show()
    await expect.element(page.getByRole('heading', { name: 'Nothing to triage' })).toBeVisible()
  })

  it('shows an error with a retry', async () => {
    fakeApi({ [`GET ${BASE}/triage`]: { status: 500, body: { error: 'boom' } } })
    await show()
    await expect.element(page.getByText('boom')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  it('holds a skeleton while loading', async () => {
    fakeFetch({ [`GET ${BASE}/triage`]: pending })
    await show()
    await expect
      .element(page.getByRole('heading', { name: 'Nothing to triage' }))
      .not.toBeInTheDocument()
  })

  it('assigns to me with M, at once', async () => {
    const api = server()
    await show()
    await expect.element(page.getByRole('button', { name: 'Assign to me' })).toBeVisible()
    await userEvent.keyboard('m')
    await vi.waitFor(() =>
      expect(api.of('POST').find((c) => c.path === `${BASE}/triage/assign`)?.body).toEqual({
        kind: 'flaky',
        key: 'home',
        assigneeId: 'u1',
      }),
    )
  })

  it('dismisses with D and moves to the next item', async () => {
    const api = server()
    await show()
    await expect.element(page.getByRole('button', { name: 'Dismiss' })).toBeVisible()
    await userEvent.keyboard('d')
    await vi.waitFor(() =>
      expect(api.of('POST').find((c) => c.path === `${BASE}/triage/dismiss`)?.body).toEqual({
        kind: 'flaky',
        key: 'home',
      }),
    )
    await expect.element(page.getByRole('list', { name: /^Flaky/ })).not.toBeInTheDocument()
    await expect.element(page.getByRole('region', { name: 'Details' })).toBeVisible()
  })

  it('snoozes with H through the shared menu', async () => {
    const api = server()
    await show()
    await expect.element(page.getByRole('button', { name: 'Snooze' })).toBeVisible()
    await userEvent.keyboard('h')
    await page.getByRole('menuitem', { name: 'Tomorrow' }).click()
    await vi.waitFor(() =>
      expect(api.of('POST').find((c) => c.path === `${BASE}/triage/snooze`)?.body).toEqual({
        kind: 'flaky',
        key: 'home',
        choice: 'tomorrow',
      }),
    )
  })

  it('moves the selection with J and K', async () => {
    server()
    await show()
    await expect
      .element(page.getByRole('region', { name: 'Details' }).getByText('home', { exact: true }))
      .toBeVisible()
    await userEvent.keyboard('j')
    await expect
      .element(page.getByRole('region', { name: 'Details' }).getByText('pricing', { exact: true }))
      .toBeVisible()
    await userEvent.keyboard('k')
    await expect
      .element(page.getByRole('region', { name: 'Details' }).getByText('home', { exact: true }))
      .toBeVisible()
  })

  it('shows the screenshot as a preview linking to its build, with an Open in build pill', async () => {
    server()
    await show()
    const preview = page.getByRole('link', { name: 'Open home in build #12' }).first()
    await expect.element(preview).toBeVisible()
    await expect.element(preview).toHaveAttribute('href', '/acme/web/builds/12?shot=home')
    expect(preview.element().textContent).toContain('Open in build')
    // The filmstrip's frames link to their own builds.
    await expect
      .element(page.getByRole('link', { name: 'Open home in build #11' }))
      .toHaveAttribute('href', '/acme/web/builds/11?shot=home')
  })

  it('opens the item in its build on a double click and on Enter, with the screenshot selected', async () => {
    server()
    const { router } = await show()
    await expect.element(page.getByRole('region', { name: 'Details' })).toBeVisible()
    await page.getByRole('button', { name: /pricing/ }).dblClick()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web/builds/12')
    expect(router.state.location.search).toMatchObject({ shot: 'pricing' })
  })

  it('opens the selected item with Enter from the list', async () => {
    server()
    const { router } = await show()
    await expect.element(page.getByRole('region', { name: 'Details' })).toBeVisible()
    await userEvent.keyboard('j')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web/builds/12')
    expect(router.state.location.search).toMatchObject({ shot: 'pricing' })
  })
})
