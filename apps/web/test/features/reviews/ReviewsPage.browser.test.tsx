import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it.
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { validateReviewsSearch } from '#features/reviews/api.ts'
import { ReviewsPage } from '#features/reviews/ReviewsPage.tsx'
import { mockAuthClient } from '#test/support/auth-client.ts'
import { fakeApi, hangingFetch } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const auth = mockAuthClient().organization

const request = (id: string, number: number, over: Record<string, unknown> = {}) => ({
  id,
  state: 'open',
  createdAt: '2026-11-08T10:00:00.000Z',
  dueAt: null,
  overdueByMs: 0,
  snoozedUntil: null,
  snoozeKind: null,
  reviewer: { id: 'me', name: 'Me' },
  requestedBy: { id: 'u2', name: 'Ada Lovelace' },
  build: {
    number,
    branch: `feature-${number}`,
    prNumber: null,
    commitSha: 'abcdef1234567',
    status: 'completed',
    conclusion: 'changed',
    reviewStatus: 'pending',
  },
  team: { slug: 'web', name: 'Web' },
  workspace: { slug: 'acme', name: 'Acme' },
  ...over,
})

const show = (url = '/workspaces/acme/reviews') =>
  renderPage(<ReviewsPage />, {
    route: '/workspaces/$workspace/reviews',
    url,
    announcer: true,
    validateSearch: validateReviewsSearch,
  })

describe('ReviewsPage', () => {
  it('lists the requests with their build, team, branch, requester and overdue badge', async () => {
    fakeApi({
      'GET /api/reviews': {
        body: {
          tab: 'for-you',
          requests: [request('r1', 12, { overdueByMs: 3 * 3600_000 + 60_000 }), request('r2', 13)],
        },
      },
    })
    await show()
    const list = page.getByRole('list', { name: 'For you' })
    await expect.element(list.getByRole('link', { name: /Build #12/ })).toBeVisible()
    await expect.element(list.getByText('feature-12')).toBeVisible()
    await expect.element(list.getByText('Requested by Ada Lovelace').first()).toBeVisible()
    await expect.element(list.getByText('Overdue 3h')).toBeVisible()
    await expect.element(page.getByRole('status').getByText('2 reviews')).toBeVisible()
    await expect.element(page.getByRole('tablist', { name: 'Reviews' })).toBeVisible()
    await expect
      .element(page.getByRole('tab', { name: 'For you' }))
      .toHaveAttribute('aria-selected', 'true')
  })

  it('shows the empty state per tab, a loading state and an error with retry', async () => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'snoozed', requests: [] } } })
    await show('/workspaces/acme/reviews?tab=snoozed')
    await expect.element(page.getByRole('heading', { name: 'Nothing snoozed' })).toBeVisible()

    fakeApi({ 'GET /api/reviews': { status: 500, body: { error: 'Boom' } } })
    await show()
    await expect.element(page.getByText('Boom')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeVisible()

    hangingFetch()
    await show()
    await expect.element(page.getByRole('list', { name: 'For you' })).not.toBeInTheDocument()
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
    const { queryClient } = await show()
    // Keep inbox and sidebar entries in the cache, as if those had been open.
    await queryClient.prefetchQuery({ queryKey: ['inbox', 'for-you'], queryFn: () => ({}) })
    await queryClient.prefetchQuery({ queryKey: ['sidebar', 'acme'], queryFn: () => ({}) })
    await expect.element(page.getByRole('link', { name: /Build #12/ })).toBeVisible()
    await page.getByRole('button', { name: 'Approve' }).click()

    await expect.element(page.getByRole('link', { name: /Build #12/ })).not.toBeInTheDocument()
    await expect.element(page.getByRole('link', { name: /Build #13/ })).toHaveFocus()
    await expect
      .element(page.getByRole('link', { name: /Build #13/ }))
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
    await show()
    await expect.element(page.getByRole('link', { name: /Build #12/ })).toBeVisible()
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
      'POST /api/teams/acme/web/builds/12/review-requests': {
        status: 201,
        body: { id: 'q1', state: 'open', dueAt: null, created: true },
      },
    })
    auth.getFullOrganization.mockResolvedValue({
      data: {
        id: 'workspace1',
        members: [
          {
            id: 'm1',
            userId: 'u2',
            role: 'member',
            user: { name: 'Ada Lovelace', email: 'a@x.io' },
          },
          {
            id: 'm2',
            userId: 'u3',
            role: 'member',
            user: { name: 'Grace Hopper', email: 'g@x.io' },
          },
        ],
      },
      error: null,
    })
    await show()
    await expect.element(page.getByRole('link', { name: /Build #12/ })).toBeVisible()
    await userEvent.keyboard('{Shift>}r{/Shift}')
    const dialog = page.getByRole('dialog', { name: 'Request a review from' })
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Grace Hopper/ }).click()
    await expect.poll(() => api.of('POST')[0]?.body).toEqual({ reviewerId: 'u3' })
  })

  it('dismisses a request and peeks at one with space', async () => {
    const api = fakeApi({
      'GET /api/reviews': { body: { tab: 'for-you', requests: [request('r1', 12)] } },
      'POST /api/teams/acme/web/review-requests/r1/dismiss': {
        body: { id: 'r1', state: 'dismissed' },
      },
    })
    await show()
    await expect.element(page.getByRole('link', { name: /Build #12/ })).toBeVisible()
    await userEvent.keyboard('j')
    await userEvent.keyboard(' ')
    await expect.element(page.getByRole('region', { name: 'Preview' })).toBeVisible()
    await expect.element(page.getByRole('link', { name: 'Open build' })).toBeVisible()
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
    await show('/workspaces/acme/reviews?tab=created')
    await expect.element(page.getByText('Asked of Bo')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Snooze' })).not.toBeInTheDocument()
  })
})
