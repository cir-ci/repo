import { AppFrame } from '@circi/ui'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it.
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { validateReviewsSearch } from '#features/reviews/api.ts'
import { ReviewsPage } from '#features/reviews/ReviewsPage.tsx'
import { PANES } from '#lib/panes.ts'
import { usePaneStore } from '#lib/stores/pane-store.ts'
import { mockAuthClient } from '#test/support/auth-client.ts'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { fakeApi, hangingFetch } from '#test/support/fetch.ts'
import { pageHeader } from '#test/support/header.ts'
import { menuItemNames } from '#test/support/menu.ts'
import { expectOnePrimaryPerArea } from '#test/support/primary-buttons.ts'
import { renderPage } from '#test/support/render.tsx'
import { expectLimitedToSpace, expectResize, parentOf } from '#test/support/resize.ts'
import { toastNamed } from '#test/support/toast.ts'

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
  requestedByName: 'Ada Lovelace',
  flakyChanges: 0,
  build: {
    number,
    branch: `feature-${number}`,
    prNumber: null,
    commitSha: 'abcdef1234567',
    status: 'complete',
    conclusion: 'changes_detected',
    reviewStatus: 'pending',
  },
  project: { slug: 'web', name: 'Web', diffThreshold: 0.01 },
  workspace: { slug: 'acme', name: 'Acme' },
  changes: { changed: 4, added: 1, removed: 0, unchanged: 38 },
  changedScreenshots: [
    { name: 'dashboard / overview', score: 0.31, sha256: 'b'.repeat(64), thumbnail: null },
    { name: 'checkout / payment-form', score: 0.024, sha256: 'a'.repeat(64), thumbnail: null },
    { name: 'settings / billing', score: 0.011, sha256: null, thumbnail: null },
  ],
  ...over,
})

// Desktop unless a test says otherwise: on a page under 880px the list and the review take turns.
const show = (url = '/workspaces/acme/reviews', viewport: [number, number] = [1280, 800]) =>
  renderPage(<ReviewsPage />, {
    viewport,
    route: '/workspaces/$workspace/reviews',
    url,
    announcer: true,
    otherRoutes: ['/$workspace/$project/builds/$number'],
    validateSearch: validateReviewsSearch,
  })

/** The vertical middle of a box: two on one line share it. */
const middle = (r: DOMRect) => r.top + r.height / 2

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

  it('keeps the header on one line and the filter buttons small and on one line on a phone', async () => {
    await page.viewport(390, 844)
    fakeApi({ 'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } } })
    await show('/workspaces/acme/reviews', [390, 844])
    const group = page.getByRole('group', { name: 'Which reviews' })
    await expect.element(group).toBeVisible()
    expect(pageHeader().getBoundingClientRect().height).toBeLessThanOrEqual(52)
    const tabs = group.getByRole('button').elements()
    expect(tabs).toHaveLength(5)
    const tops = new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top)))
    expect(tops.size, 'every filter button is on one line').toBe(1)
    for (const tab of tabs) expect(tab.getBoundingClientRect().height).toBeLessThanOrEqual(30)
    // The short names show on a phone; the full one is the desktop's.
    await expect.element(group.getByRole('button', { name: /^For you/ })).toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  })

  it('has the find field in the page header on a desktop', async () => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } } })
    await show()
    const find = page.getByRole('textbox', { name: 'Find reviews' })
    await expect.element(find).toBeVisible()
    expect(pageHeader().contains(find.element())).toBe(true)
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
  it('lists the requests with status, project, branch, requester and the overdue chip', async () => {
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

  it('selects a review into the address and shows its details and changes', async () => {
    fakeApi({
      'GET /api/reviews': {
        body: { tab: 'for-you', requests: [request('r1', 12), request('r2', 13)] },
      },
    })
    const { router } = await show()
    await page.getByRole('link', { name: /Build #13/ }).click()
    await expect.poll(() => router.state.location.search).toMatchObject({ review: 'r2' })
    const panel = page.getByRole('region', { name: 'Selected review' })
    await expect.element(panel.getByRole('heading', { name: 'Build #13' })).toBeVisible()
    // The status is an icon with a label next to the title, not a tag bar.
    await expect.element(panel.getByRole('img', { name: 'Needs review' })).toBeVisible()
    expect(panel.getByText('Needs review', { exact: true }).elements()).toHaveLength(0)
    await expect.element(panel.getByRole('heading', { name: 'Details' })).toBeVisible()
    await expect.element(panel.getByText('Screenshots')).toBeVisible()
    await expect.element(panel.getByText('4 changed')).toBeVisible()
    await expect.element(panel.getByRole('heading', { name: 'Changes', exact: true })).toBeVisible()
    // Grouped by how far above the project's 1% threshold: 31% is Large (31 or more), 2.4% and
    // 1.1% Small (under 16).
    const groups = panel
      .getByRole('heading', { level: 3 })
      .elements()
      .map((h) => h.textContent)
    expect(groups).toEqual(['Large1', 'Small2'])
    await expect
      .element(page.getByRole('region', { name: 'Large changes' }).getByRole('link'))
      .toHaveAccessibleName(/dashboard \/ overview/)
    const thumb = panel.getByRole('link', { name: /checkout \/ payment-form/ })
    await expect
      .element(thumb)
      .toHaveAttribute('href', expect.stringMatching(/builds\/13\?.*shot=checkout/))
    // Go to review is the page's one primary button; Approve all and the header's Open review are gone.
    const go = panel.getByRole('link', { name: 'Go to review' })
    await expect.element(go).toBeVisible()
    await expect.element(go).toHaveAttribute('href', expect.stringMatching(/builds\/13$/))
    await expect.element(page.getByRole('button', { name: 'Approve all' })).not.toBeInTheDocument()
    await expect.element(page.getByRole('link', { name: 'Open review' })).not.toBeInTheDocument()
    expectOnePrimaryPerArea()
    expect(document.querySelectorAll('[data-variant="primary"]')).toHaveLength(1)
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

  it('opens the snooze menu with H and sends the choice', async () => {
    const api = fakeApi({
      'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } },
      'POST /api/projects/acme/web/review-requests/r1/snooze': {
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
      'GET /api/projects/acme/web/members': {
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
      'GET /api/projects/acme/web/builds/12': {
        body: { build: { id: 'b12', number: 12, status: 'complete' } },
      },
      'POST /api/projects/acme/web/builds/request-review': {
        body: {
          requests: [
            {
              id: 'q1',
              state: 'open',
              dueAt: null,
              created: true,
              buildId: 'b12',
              reviewerId: 'u3',
            },
          ],
          undo: { id: 'ru1', expiresAt: '2099-01-01T00:00:00.000Z' },
        },
      },
    })
    await show('/workspaces/acme/reviews?review=r1')
    await expect.element(page.getByRole('heading', { name: 'Build #12' })).toBeVisible()
    await userEvent.keyboard('{Shift>}r{/Shift}')
    const dialog = page.getByRole('dialog', { name: 'Request a review from' })
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Grace Hopper/ }).click()
    await expect
      .poll(() => api.of('POST')[0]?.body)
      .toEqual({ buildIds: ['b12'], reviewerIds: ['u3'] })
    await expect.element(toastNamed('Asked Grace Hopper to review')).toBeVisible()
  })

  it('dismisses a request', async () => {
    const api = fakeApi({
      'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } },
      'POST /api/projects/acme/web/review-requests/r1/dismiss': {
        body: { id: 'r1', state: 'dismissed' },
      },
    })
    await show('/workspaces/acme/reviews?review=r1')
    await page.getByRole('button', { name: 'Dismiss' }).click()
    await expect.poll(() => api.of('POST').length).toBe(1)
    await expect.element(toastNamed(/Dismissed/)).toBeVisible()
  })

  it('has no Request review button, and Dismiss and Snooze are icon buttons in the title row', async () => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } } })
    await show('/workspaces/acme/reviews?review=r1')
    const title = page.getByRole('heading', { name: 'Build #12' })
    await expect.element(title).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Request review' }))
      .not.toBeInTheDocument()
    const row = title.element().parentElement!
    const dismiss = page.getByRole('button', { name: 'Dismiss' })
    const snooze = page.getByRole('button', { name: 'Snooze' })
    expect(row.contains(dismiss.element())).toBe(true)
    expect(row.contains(snooze.element())).toBe(true)
    // Icons, not words: the buttons hold an svg and no text.
    for (const b of [dismiss, snooze]) {
      expect(b.element().textContent).toBe('')
      expect(b.element().querySelector('svg')).not.toBeNull()
    }
    // The tooltip names the button when it is focused.
    await userEvent.hover(dismiss)
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Dismiss')
  })

  it('snoozes from the icon button, with the same options and a toast', async () => {
    const api = fakeApi({
      'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } },
      'POST /api/projects/acme/web/review-requests/r1/snooze': {
        body: {
          id: 'r1',
          snoozeKind: 'tomorrow',
          snoozedUntil: '2026-11-09T09:00:00.000Z',
          undo: { id: 'su1', expiresAt: '2099-01-01T00:00:00.000Z' },
        },
      },
    })
    await show('/workspaces/acme/reviews?review=r1')
    await page.getByRole('button', { name: 'Snooze' }).click()
    await page.getByRole('menuitem', { name: 'Tomorrow' }).click()
    await expect.poll(() => api.of('POST')[0]?.body).toEqual({ kind: 'tomorrow' })
    await expect.element(toastNamed(/Snoozed/)).toBeVisible()
  })

  it("shows the flaky tag by the branch only when the build's changes include flaky screenshots", async () => {
    fakeApi({
      'GET /api/reviews': {
        body: {
          tab: 'for-you',
          requests: [request('r1', 12, { flakyChanges: 2 }), request('r2', 13)],
        },
      },
    })
    const { router } = await show('/workspaces/acme/reviews?review=r1')
    const panel = page.getByRole('region', { name: 'Selected review' })
    await expect.element(panel.getByText('Flaky')).toBeVisible()
    await expect
      .element(panel.getByText('Flaky'))
      .toHaveAttribute('title', '2 changed screenshots known to be flaky')
    await router.navigate({
      to: '/workspaces/$workspace/reviews',
      params: { workspace: 'acme' },
      search: { tab: 'for-you', review: 'r2' },
    })
    await expect.element(panel.getByRole('heading', { name: 'Build #13' })).toBeVisible()
    expect(panel.getByText('Flaky').elements()).toHaveLength(0)
  })

  it('names the requester from the kept name once their account is gone', async () => {
    fakeApi({
      'GET /api/reviews': {
        body: {
          tab: 'for-you',
          requests: [request('r1', 12, { requestedBy: null, requestedByName: 'Ada Lovelace' })],
        },
      },
    })
    await show('/workspaces/acme/reviews?review=r1')
    const panel = page.getByRole('region', { name: 'Selected review' })
    await expect.element(panel.getByText('Requested by')).toBeVisible()
    await expect.element(panel.getByText('Ada Lovelace', { exact: false }).first()).toBeVisible()
    expect(panel.getByText('Someone who has left').elements()).toHaveLength(0)
  })

  it('shows the live name, not the kept one, while the person still resolves', async () => {
    fakeApi({
      'GET /api/reviews': {
        body: {
          tab: 'for-you',
          requests: [
            request('r1', 12, {
              requestedBy: { id: 'u2', name: 'Ada King', image: null },
              requestedByName: 'Ada Lovelace',
            }),
          ],
        },
      },
    })
    await show('/workspaces/acme/reviews?review=r1')
    const panel = page.getByRole('region', { name: 'Selected review' })
    await expect.element(panel.getByText('Ada King', { exact: false }).first()).toBeVisible()
    expect(panel.getByText('Ada Lovelace').elements()).toHaveLength(0)
  })

  it('hides the review target row once the review is answered', async () => {
    const due = '2026-11-08T08:00:00.000Z'
    fakeApi({
      'GET /api/reviews': {
        body: {
          tab: 'reviewed',
          requests: [
            request('r1', 12, {
              state: 'done',
              dueAt: due,
              closedAt: '2026-11-08T12:00:00.000Z',
              decision: 'approved',
              build: { ...request('r1', 12).build, reviewStatus: 'approved' },
            }),
          ],
        },
      },
    })
    await show('/workspaces/acme/reviews?tab=reviewed&review=r1')
    const panel = page.getByRole('region', { name: 'Selected review' })
    await expect.element(panel.getByRole('heading', { name: 'Build #12' })).toBeVisible()
    expect(panel.getByText('Review target').elements()).toHaveLength(0)
    expect(page.getByText(/Overdue/).elements()).toHaveLength(0)
  })

  it('shows the review target while the review is awaited', async () => {
    fakeApi({
      'GET /api/reviews': {
        body: {
          tab: 'for-you',
          requests: [
            request('r1', 12, { dueAt: '2026-11-08T08:00:00.000Z', overdueByMs: 3 * 3600_000 }),
          ],
        },
      },
    })
    await show('/workspaces/acme/reviews?review=r1')
    const panel = page.getByRole('region', { name: 'Selected review' })
    await expect.element(panel.getByText('Review target')).toBeVisible()
    await expect.element(panel.getByText(/Overdue 3h, target/)).toBeVisible()
  })

  it("keeps each Details value on its label's line in the half-width Details", async () => {
    await page.viewport(1280, 800)
    fakeApi({
      'GET /api/reviews': {
        body: {
          tab: 'for-you',
          requests: [
            request('r1', 12, { dueAt: '2026-11-08T08:00:00.000Z', overdueByMs: 8 * 86_400_000 }),
          ],
        },
      },
    })
    await show('/workspaces/acme/reviews?review=r1')
    const panel = page.getByRole('region', { name: 'Selected review' })
    const label = panel.getByText('Review target')
    await expect.element(label).toBeVisible()
    const value = panel.getByText(/Overdue 8d, target/)
    await expect.element(value).toBeVisible()
    // One line: the value's middle is level with the label's (it wrapped under it before).
    expect(
      Math.abs(
        middle(label.element().getBoundingClientRect()) -
          middle(value.element().getBoundingClientRect()),
      ),
    ).toBeLessThan(4)
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
  it('says who it waits on and offers Nudge, not Dismiss or Snooze', async () => {
    const api = fakeApi({
      'GET /api/reviews': { body: { tab: 'created', requests: [made()] } },
      'POST /api/projects/acme/web/review-requests/r1/nudge': { body: { id: 'r1', nudged: true } },
    })
    await show('/workspaces/acme/reviews?tab=created&review=r1')
    await expect.element(page.getByText(/Waiting on Dana Levi · requested/)).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Approve all' })).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Snooze' })).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'Nudge Dana' }).click()
    await expect.poll(() => api.of('POST').length).toBe(1)
    await expect.element(page.getByRole('button', { name: 'Nudged' })).toBeDisabled()
  })

  it('has Go to review, and no Nudge, on a request that is yours to decide', async () => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } } })
    await show('/workspaces/acme/reviews?review=r1')
    await expect.element(page.getByRole('link', { name: 'Go to review' })).toBeVisible()
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
            project: { slug: 'docs', name: 'Docs' },
          }),
        ],
      },
    },
  })

describe('ReviewsPage find field', () => {
  it('finds by build, branch, project or person, keeps the text in the address and clears it with Esc', async () => {
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

describe('ReviewsPage list width', () => {
  it('has a handle between the list and the review that resizes the list', async () => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } } })
    await show('/workspaces/acme/reviews?review=r1')
    const list = page.getByRole('complementary', { name: 'Reviews' })
    await expect.element(list).toBeVisible()
    await expectResize(
      page.getByRole('separator', { name: 'Resize the review list' }),
      'reviews-list',
      () => list.element().getBoundingClientRect().width,
      { dx: 100, grows: 1 },
    )
  })
})

describe('ReviewsPage list in a narrow window', () => {
  it('leaves the review its space, whatever width is stored', async () => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } } })
    // Wide enough (880px of page, beside the shell's sidebar) for the list beside the review.
    await show('/workspaces/acme/reviews?review=r1', [1100, 800])
    usePaneStore.setState({ widths: { 'reviews-list': PANES['reviews-list'].max } })
    const list = page.getByRole('complementary', { name: 'Reviews' })
    const detail = page.getByRole('region', { name: 'Selected review' })
    const handle = page.getByRole('separator', { name: 'Resize the review list' })
    await expect.element(detail).toBeVisible()
    await expectLimitedToSpace(handle, 'reviews-list', {
      pane: () => list.element(),
      main: () => detail.element().getBoundingClientRect().width,
      container: () => parentOf(handle.element()),
      grows: 1,
      to: 1000,
    })
  })
})

const rowFor = (n: number) => page.getByRole('link', { name: new RegExp(`Build #${n}`) }).first()

describe('right-click menu on a review', () => {
  it('offers open, link, approve and snooze on a request waiting on you', async () => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } } })
    await show()
    await rowFor(12).click({ button: 'right' })
    await expect
      .poll(() => menuItemNames())
      .toEqual([
        'Open review',
        'Open in new tab',
        'Copy link',
        'Approve',
        'Snooze until next push',
        'Snooze until tomorrow',
        'Snooze until next week',
      ])
  })

  it('approves that review without selecting it, and Undo is offered', async () => {
    const api = fakeApi({
      'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } },
      'POST /api/projects/acme/web/builds/12/review': {
        body: {
          build: { number: 12, reviewStatus: 'approved' },
          undo: { id: 'ru2', expiresAt: '2099-01-01T00:00:00.000Z' },
        },
      },
    })
    await show()
    await rowFor(12).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Approve' }).click()
    await expect.poll(() => api.of('POST')[0]?.body).toEqual({ state: 'approved' })
    await expect.element(toastNamed(/Approved/)).toBeVisible()
  })

  it('offers Nudge, not Approve, on a request you made', async () => {
    const api = fakeApi({
      'GET /api/reviews': { body: { tab: 'created', requests: [made()] } },
      'POST /api/projects/acme/web/review-requests/r1/nudge': { body: { id: 'r1', nudged: true } },
    })
    await show('/workspaces/acme/reviews?tab=created')
    await page.getByRole('link').filter({ hasText: /Build/ }).first().click({ button: 'right' })
    await expect
      .poll(() => menuItemNames())
      .toEqual(['Open review', 'Open in new tab', 'Copy link', 'Nudge Dana'])
    await page.getByRole('menuitem', { name: 'Nudge Dana' }).click()
    await expect.poll(() => api.of('POST').length).toBe(1)
    await expect.element(toastNamed('Nudged Dana Levi')).toBeVisible()
  })
})

/** The page in the app's frame, as it runs: the panel is what bounds the panes. */
const showFramed = (url: string, viewport: [number, number]) =>
  renderPage(
    <AppFrame sidebar={<span>Side</span>} compactBar={<span>Bar</span>}>
      <ReviewsPage />
    </AppFrame>,
    {
      viewport,
      route: '/workspaces/$workspace/reviews',
      url,
      announcer: true,
      otherRoutes: ['/$workspace/$project/builds/$number'],
      validateSearch: validateReviewsSearch,
    },
  )

const many = (n: number) => Array.from({ length: n }, (_, i) => request(`r${i + 1}`, i + 1))
const scroller = (el: Element) => el.closest('[data-scroll-area]')!

describe('ReviewsPage scrolling and layout', () => {
  it('scrolls the list and the details and changes each on their own, never the window', async () => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'for-you', requests: many(40) } } })
    await showFramed('/workspaces/acme/reviews?review=r1', [1400, 500])
    const panel = page.getByRole('region', { name: 'Selected review' })
    await expect.element(panel.getByRole('heading', { name: 'Build #1' })).toBeVisible()
    const list = document.getElementById('reviews-list')!
    const details = scroller(panel.getByRole('heading', { name: 'Details' }).element())
    const changes = scroller(panel.getByRole('heading', { name: 'Changes', exact: true }).element())
    expect(new Set([list, details, changes]).size, 'three scroll containers').toBe(3)
    for (const el of [list, details, changes]) {
      expect(['auto', 'scroll']).toContain(getComputedStyle(el).overflowY)
    }
    // The list overflows its own box, and the window doesn't grow with it.
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight)
    const headerTop = pageHeader().getBoundingClientRect().top
    list.scrollTop = 300
    await expect.poll(() => list.scrollTop).toBeGreaterThan(0)
    expect(window.scrollY).toBe(0)
    expect(pageHeader().getBoundingClientRect().top).toBe(headerTop)
    // The tabs stay at the top of the list column while the list scrolls.
    const tabs = page.getByRole('group', { name: 'Which reviews' }).element()
    expect(tabs.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      list.getBoundingClientRect().top + 1,
    )
  })

  it('puts the details at a third of the width with the changes to their right on a wide pane', async () => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } } })
    // Wide enough that a third is more than the details' 420px minimum.
    await showFramed('/workspaces/acme/reviews?review=r1', [2100, 900])
    const panel = page.getByRole('region', { name: 'Selected review' })
    await expect.element(panel.getByRole('heading', { name: 'Details' })).toBeVisible()
    const details = panel.getByRole('heading', { name: 'Details' }).element()
    const changes = panel.getByRole('heading', { name: 'Changes', exact: true }).element()
    const a = details.closest('[data-scroll-area]')!.getBoundingClientRect()
    const b = changes.closest('[data-scroll-area]')!.getBoundingClientRect()
    expect(b.left).toBeGreaterThanOrEqual(a.right - 1)
    // The details take a third, the changes the other two.
    expect(Math.abs(b.width - 2 * a.width)).toBeLessThan(30)
    // One change fills its group's row; two share it half and half.
    const width = (name: RegExp) =>
      panel.getByRole('link', { name }).element().getBoundingClientRect().width
    const row = panel.getByRole('list').first().element().getBoundingClientRect().width
    expect(width(/dashboard \/ overview/)).toBeGreaterThan(row - 2)
    expect(Math.abs(width(/checkout \/ payment-form/) - (row - 12) / 2)).toBeLessThan(2)
    // The picture is never drawn wider than the image (no blur), and a wide cell gets the full
    // image, not the 480px thumbnail.
    const img = panel
      .getByRole('link', { name: /dashboard \/ overview/ })
      .element()
      .querySelector('img')!
    expect(getComputedStyle(img).maxWidth).toBe('100%')
    expect(img.style.width).toBe('')
    expect(img.getAttribute('src')).toContain('b'.repeat(64))
    // Go to review is on the build's line, at its right end.
    const go = panel.getByRole('link', { name: 'Go to review' }).element()
    const title = panel.getByRole('heading', { name: 'Build #12' }).element()
    expect(
      Math.abs(middle(go.getBoundingClientRect()) - middle(title.getBoundingClientRect())),
    ).toBeLessThan(4)
    expect(Math.abs(go.getBoundingClientRect().right - b.right)).toBeLessThan(40)
  })

  it('keeps the window still when the pane is narrow beside the sidebar, the pane scrolling as one', async () => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } } })
    await showFramed('/workspaces/acme/reviews?review=r1', [900, 420])
    const panel = page.getByRole('region', { name: 'Selected review' })
    await expect.element(panel.getByRole('link', { name: 'Go to review' })).toBeVisible()
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight)
    const body = panel
      .getByRole('heading', { name: 'Details' })
      .element()
      .closest('[class*="detailBody"]')!
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
    expect(getComputedStyle(body).overflowY).toBe('auto')
  })

  it('shows the review alone when the page is too narrow for it beside the list, so no detail wraps', async () => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } } })
    await showFramed('/workspaces/acme/reviews?review=r1', [875, 800])
    const panel = page.getByRole('region', { name: 'Selected review' })
    await expect.element(panel.getByRole('heading', { name: 'Details' })).toBeVisible()
    expect(page.getByRole('complementary', { name: 'Reviews' }).elements()).toHaveLength(0)
    await expect.element(panel.getByRole('link', { name: 'Back to reviews' })).toBeVisible()
    // Each fact's label and value share one line.
    for (const label of ['Requested by', 'Compared with', 'Screenshots']) {
      const row = panel.getByText(label, { exact: true }).element().parentElement!
      expect(row.getBoundingClientRect().height).toBeLessThan(60)
    }
  })

  it('stacks the details and the changes on a narrow pane (a phone frame lets the window scroll, as before)', async () => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } } })
    await showFramed('/workspaces/acme/reviews?review=r1', [390, 700])
    const panel = page.getByRole('region', { name: 'Selected review' })
    await expect.element(panel.getByRole('heading', { name: 'Details' })).toBeVisible()
    const details = panel.getByRole('heading', { name: 'Details' }).element()
    await expect.element(panel.getByRole('link', { name: 'Go to review' })).toBeVisible()
    const changes = panel.getByRole('heading', { name: 'Changes', exact: true }).element()
    expect(changes.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      details.closest('[data-scroll-area]')!.getBoundingClientRect().bottom - 1,
    )
    // Go to review stays on the build's line on a phone too.
    const go = panel.getByRole('link', { name: 'Go to review' }).element()
    const title = panel.getByRole('heading', { name: 'Build #12' }).element()
    expect(
      Math.abs(middle(go.getBoundingClientRect()) - middle(title.getBoundingClientRect())),
    ).toBeLessThan(4)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  })
})
