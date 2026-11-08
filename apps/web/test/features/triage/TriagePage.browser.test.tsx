import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake signs Ada in.
vi.mock('#lib/auth-client.ts', () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: 'u1', name: 'Ada Lovelace' } }, isPending: false }),
  },
}))

import { TriagePage } from '#features/triage/TriagePage.tsx'
import {
  fakeApi,
  fakeFetch,
  pending,
  type ReplyHandler,
  restoreFetch,
} from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

afterEach(() => restoreFetch())

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
    [`POST ${BASE}/ignore-regions`]: (body) => {
      gone(field(field(body, 'resolves'), 'key'))
      return { status: 201, body: {} }
    },
    [`POST ${BASE}/builds/12/snapshots/review`]: { body: { build: { reviewStatus: 'approved' } } },
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

  it('accepts the snapshot as baseline with B, approving just that snapshot', async () => {
    const api = server()
    await show()
    await expect.element(page.getByRole('button', { name: 'Accept as baseline' })).toBeVisible()
    await userEvent.keyboard('b')
    await vi.waitFor(() =>
      expect(
        api.of('POST').find((c) => c.path === `${BASE}/builds/12/snapshots/review`)?.body,
      ).toEqual({
        snapshotNames: ['home'],
        decision: 'approved',
      }),
    )
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

  it('draws an ignore region with I and dismisses the item with it', async () => {
    const api = server()
    await show()
    await expect.element(page.getByRole('button', { name: 'Add ignore region' })).toBeVisible()
    await userEvent.keyboard('i')
    // The test files are not served: give the image the size it would have.
    const image = page.getByRole('img', { name: 'home in build #12' }).element()
    image.style.width = '400px'
    image.style.height = '300px'
    const layer = page.getByTestId('region-layer')
    await userEvent.dragAndDrop(layer, layer, {
      sourcePosition: { x: 40, y: 30 },
      targetPosition: { x: 200, y: 150 },
    })
    await page.getByRole('button', { name: 'Ignore this region' }).click()
    await vi.waitFor(() =>
      expect(api.of('POST').some((c) => c.path === `${BASE}/ignore-regions`)).toBe(true),
    )
    const posted = api.of('POST').find((c) => c.path === `${BASE}/ignore-regions`)?.body
    expect(field(posted, 'name')).toBe('home')
    expect(field(posted, 'resolves')).toEqual({ kind: 'flaky', key: 'home' })
    // Pixels of the 400 x 300 image (the drag lands within a pixel or two).
    expect(Number(field(posted, 'x'))).toBeCloseTo(40, -1)
    expect(Number(field(posted, 'y'))).toBeCloseTo(30, -1)
    expect(Number(field(posted, 'width'))).toBeCloseTo(160, -1)
    expect(Number(field(posted, 'height'))).toBeCloseTo(120, -1)
  })

  it('draws an ignore region from the keyboard with I, arrows and Enter', async () => {
    const api = server()
    await show()
    await expect.element(page.getByRole('button', { name: 'Add ignore region' })).toBeVisible()
    await userEvent.keyboard('i')
    const image = page.getByRole('img', { name: 'home in build #12' }).element()
    image.style.width = '400px'
    image.style.height = '300px'
    await expect.element(page.getByRole('group', { name: 'Region to mark' })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}{Shift>}{ArrowRight}{/Shift}')
    await userEvent.keyboard('{Enter}')
    await page.getByRole('button', { name: 'Ignore this region' }).click()
    await vi.waitFor(() =>
      expect(api.of('POST').some((c) => c.path === `${BASE}/ignore-regions`)).toBe(true),
    )
    const posted = api.of('POST').find((c) => c.path === `${BASE}/ignore-regions`)?.body
    expect(field(posted, 'name')).toBe('home')
    // Start 40%, 40%, 20% x 20% of 400 x 300: one step left, one step wider (21%).
    expect(Number(field(posted, 'x'))).toBe(156)
    expect(Number(field(posted, 'y'))).toBe(120)
    expect(Number(field(posted, 'width'))).toBe(84)
    expect(Number(field(posted, 'height'))).toBe(60)
  })

  it('Escape leaves the keyboard region tool, like Cancel', async () => {
    server()
    await show()
    await userEvent.keyboard('i')
    await expect.element(page.getByRole('group', { name: 'Region to mark' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect
      .element(page.getByRole('group', { name: 'Region to mark' }))
      .not.toBeInTheDocument()
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
})
