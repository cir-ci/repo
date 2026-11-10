import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it.
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { validateReviewsSearch } from '#features/reviews/api.ts'
import { ReviewsPage } from '#features/reviews/ReviewsPage.tsx'
import { mockAuthClient } from '#test/support/auth-client.ts'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { fakeApi, hangingFetch } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

mockAuthClient()

const request = (id: string, number: number, over: Record<string, unknown> = {}) => ({
  id,
  state: 'open',
  createdAt: '2026-11-08T10:00:00.000Z',
  dueAt: null,
  overdueByMs: 0,
  snoozedUntil: null,
  snoozeKind: null,
  closedAt: null,
  decision: null,
  reason: null,
  baseline: { number: 11, branch: 'main' },
  reviewer: { id: 'me', name: 'Me' },
  requestedBy: { id: 'u2', name: 'Ada Lovelace' },
  build: {
    number,
    branch: `feature-${number}`,
    prNumber: null,
    commitSha: 'abcdef1234567',
    status: 'complete',
    conclusion: 'changes_detected',
    reviewStatus: 'pending',
  },
  team: { slug: 'web', name: 'Web' },
  workspace: { slug: 'acme', name: 'Acme' },
  changes: { changed: 4, added: 1, removed: 0, unchanged: 38 },
  largestChanges: [
    { name: 'checkout / payment-form', score: 0.024, sha256: 'a'.repeat(64), thumbnail: null },
    { name: 'settings / billing', score: 0.011, sha256: null, thumbnail: null },
  ],
  ...over,
})

// Desktop unless a test says otherwise: below 720px the list and the review take turns.
const show = (url = '/workspaces/acme/reviews', viewport: [number, number] = [1280, 800]) =>
  renderPage(<ReviewsPage />, {
    viewport,
    route: '/workspaces/$workspace/reviews',
    url,
    announcer: true,
    otherRoutes: ['/$workspace/$team/builds/$number'],
    validateSearch: validateReviewsSearch,
  })

describe('ReviewsPage list header', () => {
  it('fits every tab in the 340px list, so none is clipped', async () => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } } })
    await show()
    const group = page.getByRole('group', { name: 'Which reviews' })
    await expect.element(group).toBeVisible()
    const box = group.element().getBoundingClientRect()
    expect(group.element().scrollWidth).toBeLessThanOrEqual(group.element().clientWidth)
    for (const tab of group.getByRole('button').elements()) {
      const r = tab.getBoundingClientRect()
      expect(r.left).toBeGreaterThanOrEqual(box.left)
      expect(r.right).toBeLessThanOrEqual(box.right)
    }
  })

  it('says how long a snoozed request is put off', async () => {
    const until = new Date(Date.now() + 18 * 3600_000 + 60_000).toISOString()
    fakeApi({
      'GET /api/reviews': {
        body: {
          tab: 'snoozed',
          requests: [request('r1', 12, { snoozedUntil: until, snoozeKind: 'tomorrow' })],
        },
      },
    })
    await show('/workspaces/acme/reviews?tab=snoozed')
    await expect.element(page.getByText('Snoozed for 18 hours')).toBeVisible()
    expect(page.getByText(/Until in/).elements()).toHaveLength(0)
  })
})

describe('ReviewsPage', () => {
  it('lists the requests with status, team, branch, requester and the overdue chip', async () => {
    fakeApi({
      'GET /api/reviews': {
        body: {
          tab: 'for-you',
          requests: [request('r1', 12, { overdueByMs: 3 * 3600_000 + 60_000 }), request('r2', 13)],
        },
      },
    })
    await show()
    const list = page.getByRole('list', { name: 'Needs your review' })
    await expect.element(list.getByRole('link', { name: /Build #12/ })).toBeVisible()
    await expect.element(list.getByText('feature-12')).toBeVisible()
    await expect.element(list.getByRole('img', { name: 'Ada Lovelace' }).first()).toBeVisible()
    await expect.element(list.getByText('Overdue 3h')).toBeVisible()
    await expect
      .element(page.getByRole('status', { name: '2 reviews waiting on you' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Requested from you 2' }))
      .toHaveAttribute('aria-pressed', 'true')
    // Nothing is selected until one is chosen.
    await expect.element(page.getByText('Select a review')).toBeVisible()
  })

  it('has the five tabs of the board, and Reviewed shows the decision', async () => {
    fakeApi({
      'GET /api/reviews': {
        body: {
          tab: 'reviewed',
          requests: [
            request('r1', 12, {
              state: 'done',
              decision: 'rejected',
              closedAt: '2026-11-08T11:00:00.000Z',
            }),
          ],
        },
      },
    })
    await show('/workspaces/acme/reviews?tab=reviewed&review=r1')
    // The same answer for every tab: the counts (2 waiting, 2 snoozed) come from their own lists.
    for (const name of [
      'Requested from you 1',
      'Reviewed',
      'Created by you',
      'All open',
      'Snoozed 1',
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- five tabs
      await expect.element(page.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect.element(page.getByRole('heading', { name: /Reviewed by you/ })).toBeVisible()
    await expect.element(page.getByText('Rejected by you').first()).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Approve all' })).not.toBeInTheDocument()
  })

  it('shows the reason chip, and the compared-with baseline in the details', async () => {
    fakeApi({
      'GET /api/reviews': {
        body: {
          tab: 'for-you',
          requests: [
            request('r1', 12, { reason: { kind: 'rejected_earlier', buildNumber: 11 } }),
            request('r2', 13, { reason: { kind: 're_requested' } }),
          ],
        },
      },
    })
    await show('/workspaces/acme/reviews?review=r1')
    await expect.element(page.getByRole('heading', { name: /Re-requested/ })).toBeVisible()
    await expect.element(page.getByText('Re-requested', { exact: true }).last()).toBeVisible()
    await expect.element(page.getByText('Me rejected #11')).toBeVisible()
    await expect.element(page.getByText('Compared with')).toBeVisible()
    await expect.element(page.getByText('#11 · main').first()).toBeVisible()
  })

  it('puts a build that is still being compared in its own group', async () => {
    fakeApi({
      'GET /api/reviews': {
        body: {
          tab: 'for-you',
          requests: [
            request('r1', 12),
            request('r2', 13, { build: { ...request('r2', 13).build, status: 'processing' } }),
          ],
        },
      },
    })
    await show()
    await expect.element(page.getByRole('heading', { name: /Still processing/ })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: /Needs your review/ })).toBeVisible()
  })

  it('selects a review into the address and shows its details and largest changes', async () => {
    fakeApi({
      'GET /api/reviews': {
        body: { tab: 'for-you', requests: [request('r1', 12), request('r2', 13)] },
      },
    })
    const { router } = await show()
    await page.getByRole('link', { name: /Build #13/ }).click()
    expect(router.state.location.search).toMatchObject({ review: 'r2' })
    const panel = page.getByRole('region', { name: 'Selected review' })
    await expect.element(panel.getByRole('heading', { name: 'Build #13' })).toBeVisible()
    await expect.element(panel.getByText('Needs review').first()).toBeVisible()
    await expect.element(panel.getByRole('heading', { name: 'Details' })).toBeVisible()
    await expect.element(panel.getByText('Screenshots')).toBeVisible()
    await expect.element(panel.getByText('4 changed')).toBeVisible()
    await expect.element(panel.getByRole('heading', { name: 'Largest changes' })).toBeVisible()
    const thumb = panel.getByRole('link', { name: /checkout \/ payment-form/ })
    await expect
      .element(thumb)
      .toHaveAttribute('href', expect.stringMatching(/builds\/13\?.*shot=checkout/))
    await expect.element(page.getByRole('button', { name: 'Approve all' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Snooze' })).toBeVisible()
    await expect.element(page.getByRole('link', { name: 'Open review' })).toBeVisible()
  })

  it('opens with the review in the address already selected', async () => {
    fakeApi({
      'GET /api/reviews': {
        body: { tab: 'for-you', requests: [request('r1', 12), request('r2', 13)] },
      },
    })
    await show('/workspaces/acme/reviews?review=r2')
    await expect.element(page.getByRole('heading', { name: 'Build #13' })).toBeVisible()
    await expect
      .element(page.getByRole('link', { name: /Build #13/ }).first())
      .toHaveAttribute('aria-current', 'true')
  })

  it('moves through the list with J and K, and opens the build with Enter', async () => {
    fakeApi({
      'GET /api/reviews': {
        body: { tab: 'for-you', requests: [request('r1', 12), request('r2', 13)] },
      },
    })
    const { router } = await show()
    await expect.element(page.getByRole('link', { name: /Build #12/ })).toBeVisible()
    await userEvent.keyboard('j')
    await expect.poll(() => router.state.location.search).toMatchObject({ review: 'r1' })
    await userEvent.keyboard('j')
    await expect.poll(() => router.state.location.search).toMatchObject({ review: 'r2' })
    await expect.element(page.getByRole('heading', { name: 'Build #13' })).toBeVisible()
    await userEvent.keyboard('k')
    await expect.poll(() => router.state.location.search).toMatchObject({ review: 'r1' })
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web/builds/12')
  })

  it('says nothing waits on you, in the list and in the panel', async () => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'for-you', requests: [] } } })
    await show()
    await expectEmptyState('Nothing waiting on you', {
      body: 'When a build needs your review, it shows up here and in the sidebar count.',
      tone: 'success',
    })
    // An empty list leaves the panel blank: no "Select a review", no hint.
    await expect.element(page.getByText('Select a review')).not.toBeInTheDocument()
    await expect.element(page.getByText(/move through the list/)).not.toBeInTheDocument()
  })

  it.each([
    ['created', 'No requests from you', 'Reviews you ask others for appear here.'],
    [
      'reviewed',
      'Nothing reviewed yet',
      'Requests you approve or reject show up here, latest first.',
    ],
    ['all-open', 'No open reviews', 'Every open review request in acme appears here.'],
    ['snoozed', 'Nothing snoozed', 'Requests you put off wait here until they wake.'],
  ])('says what the %s tab holds when it is empty', async (tab, title, body) => {
    fakeApi({ 'GET /api/reviews': { body: { tab, requests: [] } } })
    await show(`/workspaces/acme/reviews?tab=${tab}`)
    await expectEmptyState(title, { body })
  })

  it('shows the empty state per tab, a loading state and an error with retry', async () => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'snoozed', requests: [] } } })
    await show('/workspaces/acme/reviews?tab=snoozed')
    await expectEmptyState('Nothing snoozed', {
      body: 'Requests you put off wait here until they wake.',
    })

    fakeApi({ 'GET /api/reviews': { status: 500, body: { error: 'Boom' } } })
    await show()
    await expect.element(page.getByText('Boom')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeVisible()

    hangingFetch()
    await show()
    await expect
      .element(page.getByRole('list', { name: 'Needs your review' }))
      .not.toBeInTheDocument()
  })

  it('stacks the list and the review on a phone, with a way back', async () => {
    fakeApi({
      'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } },
    })
    const { router } = await show('/workspaces/acme/reviews', [390, 800])
    await expect.element(page.getByRole('link', { name: /Build #12/ })).toBeVisible()
    await expect.element(page.getByText('Select a review')).not.toBeVisible()
    await page.getByRole('link', { name: /Build #12/ }).click()
    await expect.element(page.getByRole('heading', { name: 'Build #12' })).toBeVisible()
    await expect.element(page.getByRole('link', { name: /^Build #12/ })).not.toBeInTheDocument()
    await page.getByRole('link', { name: 'Back to reviews' }).click()
    expect(router.state.location.search).not.toHaveProperty('review')
    await expect.element(page.getByRole('link', { name: /Build #12/ })).toBeVisible()
  })

  it('approves, moves to the next item and refetches the inbox and the sidebar', async () => {
    let approved = false
    const api = fakeApi({
      'GET /api/reviews': () => ({
        body: {
          tab: 'for-you',
          requests: approved ? [request('r2', 13)] : [request('r1', 12), request('r2', 13)],
        },
      }),
      'POST /api/teams/acme/web/builds/12/review': () => {
        approved = true
        return { body: { build: { number: 12, reviewStatus: 'approved' } } }
      },
    })
    const { queryClient } = await show('/workspaces/acme/reviews?review=r1')
    // Keep inbox and sidebar entries in the cache, as if those had been open.
    await queryClient.prefetchQuery({ queryKey: ['inbox', 'for-you'], queryFn: () => ({}) })
    await queryClient.prefetchQuery({
      queryKey: ['sidebar', 'acme'],
      queryFn: () => ({ teams: [] }),
    })
    await page.getByRole('button', { name: 'Approve all' }).click()

    await expect.element(page.getByRole('link', { name: /Build #12/ })).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('link', { name: /Build #13/ }).first())
      .toHaveAttribute('aria-current', 'true')
    expect(api.of('POST')[0]?.body).toEqual({ state: 'approved' })
    // The Inbox entry is cleared server-side: its list is fetched again.
    expect(queryClient.getQueryState(['inbox', 'for-you'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['sidebar', 'acme'])?.isInvalidated).toBe(true)
  })

  it('opens the snooze menu with H and sends the choice', async () => {
    const api = fakeApi({
      'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } },
      'POST /api/teams/acme/web/review-requests/r1/snooze': {
        body: { id: 'r1', snoozeKind: 'tomorrow', snoozedUntil: '2026-11-09T09:00:00.000Z' },
      },
    })
    await show('/workspaces/acme/reviews?review=r1')
    await expect.element(page.getByRole('heading', { name: 'Build #12' })).toBeVisible()
    await userEvent.keyboard('h')
    await expect.element(page.getByRole('menuitem')).toHaveLength(4)
    await expect.element(page.getByRole('menuitem', { name: 'Until next push' })).toBeVisible()
    await expect.element(page.getByRole('menuitem', { name: 'Custom date' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Until next push' }).click()
    await expect.poll(() => api.of('POST')[0]?.body).toEqual({ kind: 'next_push' })
  })

  it('asks a member for a review with shift+R', async () => {
    const api = fakeApi({
      'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } },
      'GET /api/teams/acme/web/members': {
        body: {
          members: [
            {
              id: 'u2',
              name: 'Ada Lovelace',
              email: 'a@x.io',
              image: null,
              role: 'member',
              addedAt: '2026-11-01T00:00:00.000Z',
            },
            {
              id: 'u3',
              name: 'Grace Hopper',
              email: 'g@x.io',
              image: null,
              role: 'member',
              addedAt: '2026-11-01T00:00:00.000Z',
            },
          ],
          canManage: false,
        },
      },
      'POST /api/teams/acme/web/builds/12/review-requests': {
        status: 201,
        body: { id: 'q1', state: 'open', dueAt: null, created: true },
      },
    })
    await show('/workspaces/acme/reviews?review=r1')
    await expect.element(page.getByRole('heading', { name: 'Build #12' })).toBeVisible()
    await userEvent.keyboard('{Shift>}r{/Shift}')
    const dialog = page.getByRole('dialog', { name: 'Request a review from' })
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Grace Hopper/ }).click()
    await expect.poll(() => api.of('POST')[0]?.body).toEqual({ reviewerId: 'u3' })
  })

  it('dismisses a request', async () => {
    const api = fakeApi({
      'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } },
      'POST /api/teams/acme/web/review-requests/r1/dismiss': {
        body: { id: 'r1', state: 'dismissed' },
      },
    })
    await show('/workspaces/acme/reviews?review=r1')
    await page.getByRole('button', { name: 'Dismiss' }).click()
    await expect.poll(() => api.of('POST').length).toBe(1)
  })

  it('has no Approve or Snooze on the Created by you tab', async () => {
    fakeApi({
      'GET /api/reviews': {
        body: {
          tab: 'created',
          requests: [request('r1', 12, { reviewer: { id: 'u9', name: 'Bo' } })],
        },
      },
    })
    await show('/workspaces/acme/reviews?tab=created&review=r1')
    await expect.element(page.getByRole('heading', { name: 'Build #12' })).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Bo' }).first()).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Approve all' })).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Snooze' })).not.toBeInTheDocument()
  })
})

const made = (over: Record<string, unknown> = {}) =>
  request('r1', 12, {
    reviewer: { id: 'u3', name: 'Dana Levi', image: null },
    requestedBy: { id: 'u1', name: 'Me', image: null },
    ...over,
  })

describe('ReviewsPage requests you made', () => {
  it('says who it waits on and offers Nudge, not Approve all, Request review or Dismiss', async () => {
    const api = fakeApi({
      'GET /api/reviews': { body: { tab: 'created', requests: [made()] } },
      'POST /api/teams/acme/web/review-requests/r1/nudge': { body: { id: 'r1', nudged: true } },
    })
    await show('/workspaces/acme/reviews?tab=created&review=r1')
    await expect.element(page.getByText(/Waiting on Dana Levi · requested/)).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Approve all' })).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Request review' }))
      .not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'Nudge Dana' }).click()
    await expect.poll(() => api.of('POST').length).toBe(1)
    await expect.element(page.getByRole('button', { name: 'Nudged' })).toBeDisabled()
  })

  it('keeps Approve all on a request that is yours to decide', async () => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } } })
    await show('/workspaces/acme/reviews?review=r1')
    await expect.element(page.getByRole('button', { name: 'Approve all' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: /Nudge/ })).not.toBeInTheDocument()
  })

  it('shows the build name in the row, the open-the-review hint and the workspace crumb', async () => {
    fakeApi({
      'GET /api/reviews': {
        body: {
          tab: 'for-you',
          requests: [
            request('r1', 12, { build: { ...request('r1', 12).build, name: 'storybook' } }),
          ],
        },
      },
    })
    await show()
    await expect.element(page.getByRole('link', { name: /Build #12 · storybook/ })).toBeVisible()
    await expect.element(page.getByText('Select a review')).toBeVisible()
    await expect
      .element(page.getByText('Pick a build from the list to read it here.'))
      .toBeVisible()
    await expect.element(page.getByRole('link', { name: 'acme' })).toBeVisible()
    expect(document.body.textContent).toContain('↵ open the review')
  })
})

const two = () =>
  fakeApi({
    'GET /api/reviews': {
      body: {
        tab: 'for-you',
        requests: [
          request('r1', 12),
          request('r2', 13, {
            requestedBy: { id: 'u3', name: 'Grace Hopper' },
            team: { slug: 'docs', name: 'Docs' },
          }),
        ],
      },
    },
  })

describe('ReviewsPage find field', () => {
  it('finds by build, branch, team or person, keeps the text in the address and clears it with Esc', async () => {
    two()
    const { router } = await show()
    const find = page.getByRole('textbox', { name: 'Find reviews' })
    await expect.element(find).toHaveAttribute('placeholder', 'Find reviews')
    await expect.element(page.getByRole('link', { name: /Build #12/ })).toBeVisible()
    await userEvent.keyboard('/')
    await expect.element(find).toHaveFocus()
    await userEvent.type(find, 'grace')
    await expect.element(page.getByRole('link', { name: /Build #13/ })).toBeVisible()
    await expect.element(page.getByRole('link', { name: /Build #12/ })).not.toBeInTheDocument()
    await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'grace' }))
    await userEvent.fill(find, 'feature-12')
    await expect.element(page.getByRole('link', { name: /Build #12/ })).toBeVisible()
    await userEvent.fill(find, 'docs')
    await expect.element(page.getByRole('link', { name: /Build #13/ })).toBeVisible()
    await userEvent.fill(find, 'nobody')
    await expectEmptyState('No review matches “nobody”', { action: 'Clear search' })
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect.element(find).toHaveValue('')
    await userEvent.fill(find, 'nobody')
    await userEvent.keyboard('{Escape}')
    await expect.element(find).toHaveValue('')
    await expect.element(page.getByRole('link', { name: /Build #12/ })).toBeVisible()
    await vi.waitFor(() => expect(router.state.location.search).not.toHaveProperty('q'))
  })

  it('opens with the find text and the review of the address', async () => {
    two()
    await show('/workspaces/acme/reviews?q=docs&review=r2')
    await expect.element(page.getByRole('textbox', { name: 'Find reviews' })).toHaveValue('docs')
    await expect.element(page.getByRole('region', { name: 'Selected review' })).toBeVisible()
    await expect
      .element(
        page
          .getByRole('region', { name: 'Selected review' })
          .getByText(/Build #13/)
          .first(),
      )
      .toBeVisible()
  })
})
