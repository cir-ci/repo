import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake signs Ada in.
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { TriagePage } from '#features/triage/TriagePage.tsx'
import { PANES } from '#lib/panes.ts'
import { usePaneStore } from '#lib/stores/pane-store.ts'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { fakeApi, fakeFetch, pending, type ReplyHandler } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'
import { expectLimitedToSpace, expectResize, parentOf } from '#test/support/resize.ts'
import { toastNamed } from '#test/support/toast.ts'

const BASE = '/api/teams/acme/web'

const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 3600_000).toISOString()

/** Ten builds on main, oldest first; the screenshot changed in the even ones. */
const tenBuilds = Array.from({ length: 10 }, (_, i) => ({ number: 3 + i, changed: i % 2 === 1 }))

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
    createdAt: TWO_DAYS_AGO,
  },
  assignee: null,
  snoozedUntil: null,
  snoozeKind: null,
  snoozed: false,
  history: [],
  reason: null,
  error: null,
  blocking: 0,
  ...over,
})

const queue = (items: unknown[], onTriage: { id: string; name: string } | null = null) => ({
  items,
  rotation: {
    members: onTriage ? [onTriage] : [],
    onTriage,
    until: onTriage ? '2026-11-16T12:00:00.000Z' : null,
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
    otherRoutes: ['/$workspace/$team/builds/$number', '/$workspace/$team/settings/reviews'],
    announcer: true,
  })

const items = () => [
  item('home', { history: tenBuilds, blocking: 2 }),
  item('pricing', { kind: 'no_baseline' }),
  item('build:9', {
    kind: 'failed',
    snapshotName: null,
    error: '2 files over the 25 MB limit',
    build: { ...item('x').build, number: 9, status: 'error' },
  }),
]

/** A server whose queue loses an item once it is acted on, as the real one does. */
const field = (body: unknown, key: string): unknown =>
  typeof body === 'object' && body !== null ? Reflect.get(body, key) : undefined

function server() {
  let current = items()
  /** The queue before each change, by the token its answer carried: what Undo puts back. */
  const before = new Map<string, typeof current>()
  const token = () => {
    const id = `t${before.size + 1}`
    before.set(id, current)
    return { id, expiresAt: '2099-01-01T00:00:00.000Z' }
  }
  const gone = (key: unknown) => {
    const undo = token()
    current = current.filter((i) => i.key !== key)
    return { body: { undo } }
  }
  const routes: Record<string, ReplyHandler> = {
    [`GET ${BASE}/triage`]: () => ({ body: queue(current) }),
    [`GET ${BASE}/snapshots/home/history`]: { body: history },
    [`GET ${BASE}/snapshots/pricing/history`]: { body: { ...history, default: [] } },
    [`POST ${BASE}/triage/dismiss`]: (body) => gone(field(body, 'key')),
    [`POST ${BASE}/triage/snooze`]: (body) => gone(field(body, 'key')),
    [`POST ${BASE}/triage/assign`]: () => ({ body: { undo: token() } }),
    [`POST ${BASE}/triage/rerun`]: (body) => {
      current = current.filter((i) => i.build.number !== field(body, 'number'))
      return { body: { build: { number: field(body, 'number'), status: 'processing' } } }
    },
  }
  for (const id of ['t1', 't2', 't3']) {
    routes[`POST ${BASE}/undo/${id}`] = () => {
      current = before.get(id) ?? current
      return { body: { undone: true } }
    }
  }
  return fakeApi(routes)
}

/** A queue of one flaky screenshot with the given reason. */
function flakyServer(reason: unknown) {
  return fakeApi({
    [`GET ${BASE}/triage`]: { body: queue([item('home', { history: tenBuilds, reason })]) },
    [`GET ${BASE}/snapshots/home/history`]: { body: history },
  })
}

/** The pane beside the list. */
const pane = () => page.getByRole('region', { name: 'Details' })

describe('TriagePage', () => {
  it('groups the queue under labelled lists with counts and names rows by kind and snapshot', async () => {
    server()
    await show()
    await expect.element(page.getByRole('heading', { name: /^Flaky/ })).toBeVisible()
    await expect.element(page.getByRole('list', { name: 'Flaky, 1 item' })).toBeVisible()
    await expect.element(page.getByRole('list', { name: 'No baseline, 1 item' })).toBeVisible()
    await expect.element(page.getByRole('list', { name: 'Failed, 1 item' })).toBeVisible()
    await expect.element(page.getByText('Flaky, home, build #12, main.')).toBeInTheDocument()
    await expect.element(page.getByRole('status').getByText('3', { exact: true })).toBeVisible()
  })

  it('shows the last 10 commits of a flaky screenshot as cells, the changed ones marked', async () => {
    server()
    await show()
    const film = page.getByRole('list', { name: 'Changed in 5 of the last 10 commits' })
    await expect.element(film).toBeVisible()
    expect(film.getByRole('listitem').elements()).toHaveLength(10)
    await expect
      .element(film.getByRole('link', { name: 'Open home in build #4, changed' }))
      .toHaveAttribute('href', '/acme/web/builds/4?shot=home')
    await expect
      .element(film.getByRole('link', { name: 'Open home in build #3, same' }))
      .toBeVisible()
    await expect.element(page.getByText('Last 10 commits on main')).toBeVisible()
    await expect.element(page.getByText('Where it changes')).toBeVisible()
  })

  it('says why each row is in the queue, how old it is, and who has it', async () => {
    fakeApi({
      [`GET ${BASE}/triage`]: {
        body: queue([
          item('home', {
            history: tenBuilds,
            reason: {
              kind: 'reruns_disagree',
              reruns: { build: 9, runs: 2, differing: 1, commits: 1 },
            },
          }),
          item('pricing', {
            kind: 'no_baseline',
            assignee: { id: 'u2', name: 'Grace', image: null },
          }),
          item('build:9', { kind: 'failed', snapshotName: null, error: 'Upload rejected' }),
        ]),
      },
    })
    await show()
    const flaky = page.getByRole('list', { name: 'Flaky, 1 item' })
    await expect.element(flaky.getByText('Differed across 2 runs of one commit')).toBeVisible()
    await expect.element(flaky.getByText('2d')).toBeVisible()
    await expect.element(flaky.getByRole('img', { name: 'Unassigned' })).toBeVisible()
    const none = page.getByRole('list', { name: 'No baseline, 1 item' })
    await expect.element(none.getByText('First seen in build #12')).toBeVisible()
    await expect.element(none.getByRole('img', { name: 'Grace' })).toBeVisible()
    await expect
      .element(page.getByRole('list', { name: 'Failed, 1 item' }).getByText('Upload rejected'))
      .toBeVisible()
  })

  it('reads the filmstrip with one history request, not one per build', async () => {
    const api = server()
    await show()
    await expect.element(page.getByRole('list', { name: /^Changed in/ })).toBeVisible()
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
    await expect.element(page.getByLabelText('On triage: Grace Hopper until Mon')).toBeVisible()
    // Settings is a closed area: no link from the triage page into the team's settings.
    expect(page.getByRole('link', { name: 'Rules' }).elements()).toHaveLength(0)
  })

  it('says triage is clear, centred in the content area, with the board copy and no find field', async () => {
    await page.viewport(1200, 800)
    fakeApi({ [`GET ${BASE}/triage`]: { body: queue([]) } })
    await show()
    const title = page.getByRole('heading', { name: 'Triage is clear' })
    // The icon is the approved glyph (a 32px filled circle), and the block sits in the middle of the page.
    const root = await expectEmptyState('Triage is clear', {
      body: 'Flaky screenshots, missing baselines and failed builds on the default branch appear here.',
      tone: 'success',
      centred: true,
    })
    expect(root.querySelector('svg[data-status="approved"]')).not.toBeNull()
    const box = title.element().getBoundingClientRect()
    const main =
      title.element().closest('main')?.getBoundingClientRect() ?? new DOMRect(0, 0, 1200, 800)
    expect(Math.abs(box.left + box.width / 2 - (main.left + main.width / 2))).toBeLessThan(24)
    expect(box.top).toBeGreaterThan(main.top + 80)
    expect(page.getByRole('textbox', { name: 'Find triage items' }).elements()).toHaveLength(0)
  })

  it('finds items by screenshot, build or kind, keeps the text in the address and says when nothing matches', async () => {
    server()
    const { router } = await show()
    const find = page.getByRole('textbox', { name: 'Find triage items' })
    await expect.element(find).toHaveAttribute('placeholder', 'Find triage items')
    await userEvent.fill(find, 'pric')
    await expect.element(page.getByRole('list', { name: 'No baseline, 1 item' })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: /^Flaky/ })).not.toBeInTheDocument()
    await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'pric' }))
    await userEvent.fill(find, '#9')
    await expect.element(page.getByRole('list', { name: 'Failed, 1 item' })).toBeVisible()
    await userEvent.fill(find, 'zzz')
    await expectEmptyState('No triage item matches “zzz”', { action: 'Clear search' })
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect.element(find).toHaveValue('')
    await userEvent.fill(find, 'zzz')
    await userEvent.keyboard('{Escape}')
    await expect.element(find).toHaveValue('')
    await expect.element(page.getByRole('list', { name: 'Flaky, 1 item' })).toBeVisible()
  })

  it('opens with the item of the address selected', async () => {
    server()
    await renderPage(<TriagePage />, {
      route: '/$workspace/$team/triage',
      url: '/acme/web/triage?item=no_baseline%3Apricing',
      otherRoutes: ['/$workspace/$team/builds/$number', '/$workspace/$team/settings/reviews'],
      announcer: true,
    })
    await expect.element(pane().getByRole('heading', { name: 'pricing' })).toBeVisible()
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

  it('says Assigned to you in a toast, and Undo takes it back', async () => {
    const api = server()
    await show()
    await expect.element(page.getByRole('button', { name: 'Assign to me' })).toBeVisible()
    await userEvent.keyboard('m')
    await expect.element(toastNamed('Assigned to you')).toBeVisible()
    await toastNamed('Assigned to you').getByRole('button', { name: 'Undo' }).click()
    await expect.element(toastNamed('Undone')).toBeVisible()
    expect(api.of('POST').map((c) => c.path)).toEqual([`${BASE}/triage/assign`, `${BASE}/undo/t1`])
  })

  it('names the failure in a toast when assigning fails', async () => {
    const api = server()
    api.set(`POST ${BASE}/triage/assign`, {
      status: 403,
      body: { error: 'Only members can triage' },
    })
    await show()
    await expect.element(page.getByRole('button', { name: 'Assign to me' })).toBeVisible()
    await userEvent.keyboard('m')
    await expect
      .element(toastNamed("Couldn't update the item: Only members can triage"))
      .toBeVisible()
  })

  it('dismisses at once with a Dismissed toast, and Undo brings the item back', async () => {
    const api = server()
    await show()
    await expect.element(page.getByRole('button', { name: 'Dismiss' })).toBeVisible()
    await userEvent.keyboard('d')
    await expect.element(toastNamed('Dismissed')).toBeVisible()
    await expect.element(page.getByRole('list', { name: /^Flaky/ })).not.toBeInTheDocument()
    await toastNamed('Dismissed').getByRole('button', { name: 'Undo' }).click()
    await expect.element(toastNamed('Undone')).toBeVisible()
    await expect.element(page.getByRole('list', { name: /^Flaky/ })).toBeVisible()
    expect(api.of('POST').map((c) => c.path)).toContain(`${BASE}/undo/t1`)
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
    await expect.element(pane()).toBeVisible()
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
    await expect.element(pane().getByRole('heading', { level: 3, name: 'home' })).toBeVisible()
    await userEvent.keyboard('j')
    await expect.element(pane().getByRole('heading', { level: 3, name: 'pricing' })).toBeVisible()
    await userEvent.keyboard('k')
    await expect.element(pane().getByRole('heading', { level: 3, name: 'home' })).toBeVisible()
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
      .element(page.getByRole('link', { name: 'Open home in build #11, same' }))
      .toHaveAttribute('href', '/acme/web/builds/11?shot=home')
  })

  it('opens the item in its build on a double click and on Enter, with the screenshot selected', async () => {
    server()
    const { router } = await show()
    await expect.element(pane()).toBeVisible()
    await page.getByRole('button', { name: /pricing/ }).dblClick()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web/builds/12')
    expect(router.state.location.search).toMatchObject({ shot: 'pricing' })
  })

  it('opens the selected item with Enter from the list', async () => {
    server()
    const { router } = await show()
    await expect.element(pane()).toBeVisible()
    await userEvent.keyboard('j')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web/builds/12')
    expect(router.state.location.search).toMatchObject({ shot: 'pricing' })
  })

  it('shows the pane facts and the actions at the bottom of the pane', async () => {
    server()
    await show()
    const facts = pane()
    await expect.element(facts.getByText('Assignee')).toBeVisible()
    await expect.element(facts.getByText('In triage for')).toBeVisible()
    await expect.element(facts.getByText('2 days')).toBeVisible()
    await expect.element(facts.getByText('2 pull requests show it as changed')).toBeVisible()
    await expect.element(facts.getByText('Unassigned')).toBeVisible()
    for (const name of ['Assign to me', 'Snooze', 'Dismiss']) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      await expect.element(facts.getByRole('button', { name })).toBeVisible()
    }
    await expect
      .element(facts.getByRole('button', { name: 'Re-run comparison' }))
      .not.toBeInTheDocument()
  })

  it('names who is on triage beside Unassigned', async () => {
    fakeApi({
      [`GET ${BASE}/triage`]: { body: queue([item('home')], { id: 'u2', name: 'Grace Hopper' }) },
    })
    await show()
    await expect.element(pane().getByText('Unassigned · Grace Hopper is on triage')).toBeVisible()
  })

  it('says an assignee was picked automatically, not by a person', async () => {
    fakeApi({
      [`GET ${BASE}/triage`]: {
        body: queue([
          item('home', { assignee: { id: 'u2', name: 'Grace Hopper', image: null, auto: true } }),
        ]),
      },
    })
    await show()
    await expect.element(pane().getByText('· on triage')).toBeVisible()
  })

  it('shows no such note for an assignee a person chose', async () => {
    fakeApi({
      [`GET ${BASE}/triage`]: {
        body: queue([
          item('home', { assignee: { id: 'u2', name: 'Grace Hopper', image: null, auto: false } }),
        ]),
      },
    })
    await show()
    await expect.element(pane().getByText('Grace Hopper')).toBeVisible()
    expect(pane().getByText('· on triage').elements()).toHaveLength(0)
  })

  it('shows a new screenshot with no baseline next to where it was first seen', async () => {
    server()
    await show()
    await userEvent.keyboard('j')
    await expect.element(pane().getByText('None yet')).toBeVisible()
    await expect.element(pane().getByText('First seen in #12')).toBeVisible()
    await expect
      .element(pane().getByRole('button', { name: 'Re-run comparison' }))
      .not.toBeInTheDocument()
  })

  it('shows why a failed build failed and re-runs its comparison, counting it as handled', async () => {
    const api = server()
    await show()
    await userEvent.keyboard('j')
    await userEvent.keyboard('j')
    await expect.element(pane().getByText('2 files over the 25 MB limit')).toBeVisible()
    await expect.element(pane().getByText('The check on this commit is failing')).toBeVisible()
    await pane().getByRole('button', { name: 'Re-run comparison' }).click()
    await vi.waitFor(() =>
      expect(api.of('POST').find((c) => c.path === `${BASE}/triage/rerun`)?.body).toEqual({
        number: 9,
      }),
    )
    await expect.element(page.getByRole('list', { name: /^Failed/ })).not.toBeInTheDocument()
    await expect.element(page.getByRole('status').getByText('2 · 1 handled')).toBeVisible()
  })

  describe('why it is flaky', () => {
    const both = {
      kind: 'both',
      flipFlop: {
        count: 2,
        threshold: 2,
        window: 10,
        returns: [
          { build: 7, backTo: 5 },
          { build: 11, backTo: 9 },
        ],
      },
      reruns: { build: 9, runs: 3, differing: 2, commits: 1 },
    }

    it('says it in a section of the pane, with the evidence as links to the builds involved', async () => {
      flakyServer(both)
      await show()
      const why = pane().getByText("Why it's flaky")
      await expect.element(why).toBeVisible()
      await expect
        .element(
          pane().getByText(
            "Differed across 3 runs of one commit and came back to an earlier image 2 times in the last 10 commits; the team's limit is 2, and one disagreement is enough.",
          ),
        )
        .toBeVisible()
      const evidence = pane().getByRole('list', { name: 'Evidence' })
      const lines = evidence.getByRole('listitem')
      await expect.element(lines.nth(0)).toHaveTextContent("#7 went back to #5's image")
      await expect.element(lines.nth(1)).toHaveTextContent("#11 went back to #9's image")
      await expect.element(lines.nth(2)).toHaveTextContent('#9: 2 of 3 runs differ')
      await expect
        .element(evidence.getByRole('link', { name: 'Open home in build #7' }))
        .toHaveAttribute('href', '/acme/web/builds/7?shot=home')
      await expect
        .element(evidence.getByRole('link', { name: 'Open home in build #9' }))
        .toHaveAttribute('href', '/acme/web/builds/9?shot=home')
    })

    it('marks the strip cells of the builds that went back, and the row says it short', async () => {
      flakyServer(both)
      await show()
      const film = page.getByRole('list', { name: 'Changed in 5 of the last 10 commits' })
      await expect
        .element(film.getByRole('link', { name: /^Open home in build #7,.*part of why/ }))
        .toBeVisible()
      await expect
        .element(film.getByRole('link', { name: 'Open home in build #8, changed' }))
        .toBeVisible()
      await expect
        .element(
          page
            .getByRole('list', { name: 'Flaky, 1 item' })
            .getByText(
              'Differed across 3 runs of one commit and came back to an earlier image 2 times',
            ),
        )
        .toBeVisible()
    })

    it('says a flip-flop alone, with the limit', async () => {
      flakyServer({
        kind: 'flip_flop',
        flipFlop: { ...both.flipFlop, count: 1, returns: [{ build: 7, backTo: 5 }] },
      })
      await show()
      await expect
        .element(
          pane().getByText(
            "Came back to an earlier image once in the last 10 commits; the team's limit is 2.",
          ),
        )
        .toBeVisible()
    })
  })

  it('counts snoozed and dismissed items as handled', async () => {
    server()
    await show()
    await userEvent.keyboard('d')
    await expect.element(page.getByRole('status').getByText('2 · 1 handled')).toBeVisible()
  })
})

describe('resizing the details pane', () => {
  it('has a handle that resizes the pane and keeps the width', async () => {
    server()
    await renderPage(<TriagePage />, {
      route: '/$workspace/$team/triage',
      url: '/acme/web/triage?item=no_baseline%3Apricing',
      otherRoutes: ['/$workspace/$team/builds/$number', '/$workspace/$team/settings/reviews'],
      announcer: true,
      viewport: [1400, 900],
    })
    await expect.element(pane().getByRole('heading', { name: 'pricing' })).toBeVisible()
    await expectResize(
      page.getByRole('separator', { name: 'Resize the details pane' }),
      'triage-pane',
      () => pane().element().getBoundingClientRect().width,
      { dx: -60, grows: -1 },
    )
  })
})

describe('the details pane in a narrow window', () => {
  it('leaves the list its space, whatever width is stored', async () => {
    server()
    await renderPage(<TriagePage />, {
      route: '/$workspace/$team/triage',
      url: '/acme/web/triage?item=no_baseline%3Apricing',
      otherRoutes: ['/$workspace/$team/builds/$number', '/$workspace/$team/settings/reviews'],
      announcer: true,
      viewport: [900, 800],
    })
    usePaneStore.setState({ widths: { 'triage-pane': PANES['triage-pane'].max } })
    await expect.element(pane().getByRole('heading', { name: 'pricing' })).toBeVisible()
    const handle = page.getByRole('separator', { name: 'Resize the details pane' })
    const split = () => parentOf(handle.element())
    await expectLimitedToSpace(handle, 'triage-pane', {
      pane: () => pane().element(),
      main: () => split().firstElementChild?.getBoundingClientRect().width ?? 0,
      container: split,
      grows: -1,
      to: 740,
    })
  })
})
