import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { validateInboxSearch } from '#features/inbox/api.ts'
import { InboxPage } from '#features/inbox/InboxPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'review_requested',
  createdAt: '2026-11-08T10:00:00.000Z',
  readAt: null,
  snoozedUntil: null,
  payload: {},
  actor: { id: 'u2', name: 'Ada' },
  build: { number: 12, branch: 'main', prNumber: null, commitSha: 'abcdef1234567' },
  team: { slug: 'web', name: 'Web' },
  workspace: { slug: 'acme', name: 'Acme' },
  alsoInReviews: false,
  ...over,
})

const list = (items: unknown[], tab = 'for-you') => ({
  body: { tab, unread: items.length, items },
})

const show = (url = '/inbox') =>
  renderPage(<InboxPage />, {
    route: '/inbox',
    url,
    announcer: true,
    validateSearch: validateInboxSearch,
  })

describe('InboxPage', () => {
  it('words each row, tags builds also in Reviews and flags unread ones', async () => {
    fakeApi({
      'GET /api/inbox': list([
        item('n1', { alsoInReviews: true }),
        item('n2', {
          kind: 'build_rejected',
          build: { number: 13, branch: 'x', prNumber: null, commitSha: 'abc' },
          payload: { reason: 'Logo moved' },
          readAt: '2026-11-08T11:00:00.000Z',
        }),
      ]),
    })
    await show()
    const rows = page.getByRole('list', { name: 'For you' })
    await expect.element(rows.getByText('Ada requested your review of build #12')).toBeVisible()
    await expect.element(rows.getByText('Also in Reviews')).toBeVisible()
    await expect.element(rows.getByText('Unread.')).toBeInTheDocument()
    await expect.element(rows.getByText('Ada rejected build #13')).toBeVisible()
    await expect.element(rows.getByText('Logo moved')).toBeVisible()
    await expect
      .element(page.getByRole('status').getByText('2 notifications, 1 unread'))
      .toBeVisible()
    await expect.element(page.getByRole('tablist', { name: 'Inbox' })).toBeVisible()
  })

  it('marks read or unread with U', async () => {
    let readAt: string | null = null
    const api = fakeApi({
      'GET /api/inbox': () => list([item('n1', { readAt })]),
      'POST /api/inbox/n1/read': (body) => {
        readAt =
          typeof body === 'object' && body !== null && 'read' in body && body.read
            ? '2026-11-08T12:00:00.000Z'
            : null
        return { body: { id: 'n1', readAt, snoozedUntil: null } }
      },
    })
    await show()
    await expect.element(page.getByRole('button', { name: 'Mark read' })).toBeVisible()
    await userEvent.keyboard('u')
    await expect.element(page.getByRole('button', { name: 'Mark unread' })).toBeVisible()
    expect(api.of('POST')[0]?.body).toEqual({ read: true })
    await userEvent.keyboard('u')
    await expect.element(page.getByRole('button', { name: 'Mark read' })).toBeVisible()
    expect(api.of('POST')[1]?.body).toEqual({ read: false })
  })

  it('snoozes with H, offering a time only', async () => {
    const api = fakeApi({
      'GET /api/inbox': list([item('n1')]),
      'POST /api/inbox/n1/snooze': { body: { id: 'n1', readAt: null, snoozedUntil: 'x' } },
    })
    await show()
    await expect.element(page.getByRole('button', { name: 'Snooze' })).toBeVisible()
    await userEvent.keyboard('h')
    await expect.element(page.getByRole('menuitem', { name: 'Tomorrow' })).toBeVisible()
    await expect.element(page.getByRole('menuitem', { name: 'Next week' })).toBeVisible()
    await expect.element(page.getByRole('menuitem', { name: 'Custom date' })).toBeVisible()
    await expect
      .element(page.getByRole('menuitem', { name: 'Until next push' }))
      .not.toBeInTheDocument()
    await page.getByRole('menuitem', { name: 'Next week' }).click()
    await expect.poll(() => api.of('POST')[0]?.body).toEqual({ choice: 'next_week' })
  })

  it('deletes with backspace and selects the next row', async () => {
    let gone = false
    const api = fakeApi({
      'GET /api/inbox': () =>
        list(
          gone
            ? [item('n2', { kind: 'mentioned', payload: { snippet: 'hi' } })]
            : [item('n1'), item('n2', { kind: 'mentioned', payload: { snippet: 'hi' } })],
        ),
      'DELETE /api/inbox/n1': () => {
        gone = true
        return { status: 204 }
      },
    })
    await show()
    await expect.element(page.getByText('Ada requested your review of build #12')).toBeVisible()
    await userEvent.keyboard('{Backspace}')
    await expect
      .element(page.getByText('Ada requested your review of build #12'))
      .not.toBeInTheDocument()
    expect(api.of('DELETE')).toHaveLength(1)
    await expect.element(page.getByRole('link', { name: /mentioned you/ })).toHaveFocus()
  })

  it('marks read when a row is opened and refreshes the sidebar count', async () => {
    const api = fakeApi({
      'GET /api/inbox': list([item('n1')]),
      'POST /api/inbox/n1/read': { body: { id: 'n1', readAt: 'x', snoozedUntil: null } },
    })
    const { router, queryClient } = await show()
    await queryClient.prefetchQuery({ queryKey: ['sidebar', 'acme'], queryFn: () => ({}) })
    await page.getByRole('link', { name: /requested your review/ }).click()
    await expect.poll(() => api.of('POST')[0]?.body).toEqual({ read: true })
    await expect
      .poll(() => queryClient.getQueryState(['sidebar', 'acme'])?.isInvalidated)
      .toBe(true)
    expect(router.state.location.pathname).toBe('/acme/web/builds/12')
  })

  it('marks everything read, and peeks with space', async () => {
    const api = fakeApi({
      'GET /api/inbox': list([item('n1'), item('n2')]),
      'POST /api/inbox/read-all': { body: { marked: 2 } },
    })
    await show()
    await userEvent.keyboard('j')
    await userEvent.keyboard(' ')
    await expect.element(page.getByRole('region', { name: 'Preview' })).toBeVisible()
    await page.getByRole('button', { name: 'Mark all read' }).click()
    await expect.poll(() => api.of('POST').length).toBe(1)
  })

  it('shows the Snoozed tab with Unsnooze and an empty state', async () => {
    const api = fakeApi({
      'GET /api/inbox': list([item('n1', { snoozedUntil: '2026-11-09T09:00:00.000Z' })], 'snoozed'),
      'POST /api/inbox/n1/unsnooze': { body: { id: 'n1', readAt: null, snoozedUntil: null } },
    })
    await show('/inbox?tab=snoozed')
    await expect.element(page.getByRole('button', { name: 'Snooze' })).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'Unsnooze' }).click()
    await expect.poll(() => api.of('POST').length).toBe(1)
  })

  it('shows the empty state', async () => {
    fakeApi({ 'GET /api/inbox': list([]) })
    await show()
    await expect.element(page.getByRole('heading', { name: "You're all caught up" })).toBeVisible()
  })
})
