import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { validateInboxSearch } from '#features/inbox/api.ts'
import { InboxPage } from '#features/inbox/InboxPage.tsx'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'
import { expectResize } from '#test/support/resize.ts'

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'review_requested',
  createdAt: '2026-11-08T10:00:00.000Z',
  readAt: null,
  snoozedUntil: null,
  payload: {},
  actor: { id: 'u2', name: 'Ada', image: null },
  build: {
    number: 12,
    name: 'default',
    branch: 'main',
    prNumber: null,
    commitSha: 'abcdef1234567',
    status: 'complete',
    reviewStatus: 'pending',
  },
  changes: { changed: 4, added: 1, removed: 0, unchanged: 38 },
  request: { dueAt: null, overdueByMs: 0 },
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
          build: {
            number: 13,
            name: 'default',
            branch: 'x',
            prNumber: null,
            commitSha: 'abc',
            status: 'complete',
            reviewStatus: 'rejected',
          },
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
    await expect
      .element(
        page
          .getByRole('list', { name: 'For you' })
          .getByText('Ada requested your review of build #12'),
      )
      .toBeVisible()
    await userEvent.keyboard('{Backspace}')
    await expect
      .element(
        page
          .getByRole('list', { name: 'For you' })
          .getByText('Ada requested your review of build #12'),
      )
      .not.toBeInTheDocument()
    expect(api.of('DELETE')).toHaveLength(1)
    await expect.element(page.getByRole('button', { name: /mentioned you/ })).toHaveFocus()
  })

  it('selects a row into the pane and marks it read; Open goes to the build', async () => {
    const api = fakeApi({
      'GET /api/inbox': list([item('n1'), item('n2', { kind: 'build_approved' })]),
      'POST /api/inbox/n2/read': { body: { id: 'n2', readAt: 'x', snoozedUntil: null } },
      'POST /api/inbox/n1/read': { body: { id: 'n1', readAt: 'x', snoozedUntil: null } },
    })
    const { router, queryClient } = await show()
    await queryClient.prefetchQuery({ queryKey: ['sidebar', 'acme'], queryFn: () => ({}) })
    const pane = page.getByRole('region', { name: 'Notification' })
    await expect.element(pane.getByText('Ada requested your review of build #12')).toBeVisible()
    await page.getByRole('button', { name: /approved build #12/ }).click()
    await expect.element(pane.getByText('Ada approved build #12')).toBeVisible()
    await expect.poll(() => api.of('POST')[0]?.body).toEqual({ read: true })
    await expect
      .poll(() => queryClient.getQueryState(['sidebar', 'acme'])?.isInvalidated)
      .toBe(true)
    expect(router.state.location.pathname).toBe('/inbox')
    await pane.getByRole('link', { name: 'Open build' }).click()
    expect(router.state.location.pathname).toBe('/acme/web/builds/12')
  })

  it('moves through the list with j and k, and Enter opens the build', async () => {
    fakeApi({
      'GET /api/inbox': list([item('n1'), item('n2', { kind: 'build_approved' })]),
      'POST /api/inbox/n1/read': { body: { id: 'n1', readAt: 'x', snoozedUntil: null } },
    })
    const { router } = await show()
    const pane = page.getByRole('region', { name: 'Notification' })
    await userEvent.keyboard('j')
    await expect.element(pane.getByText('Ada approved build #12')).toBeVisible()
    await userEvent.keyboard('k')
    await expect.element(pane.getByText('Ada requested your review of build #12')).toBeVisible()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web/builds/12')
  })

  it('shows the details table, the note, and "Also in Reviews" in the pane', async () => {
    fakeApi({
      'GET /api/inbox': list([
        item('n1', {
          alsoInReviews: true,
          kind: 'build_rejected',
          payload: { reason: 'Logo moved' },
          request: { dueAt: '2026-11-08T08:00:00.000Z', overdueByMs: 2 * 3600_000 },
        }),
      ]),
    })
    await show()
    const pane = page.getByRole('region', { name: 'Notification' })
    await expect.element(pane.getByText('Also in Reviews')).toBeVisible()
    await expect.element(pane.getByText('Logo moved')).toBeVisible()
    await expect.element(pane.getByText('Branch')).toBeVisible()
    await expect.element(pane.getByText('4 changed, 1 added')).toBeVisible()
    await expect.element(pane.getByText('38 same')).toBeVisible()
    await expect.element(pane.getByText(/Overdue 2h/)).toBeVisible()
  })

  it('approves everything from the pane while the build awaits your review, with shift+A', async () => {
    let approved = false
    const api = fakeApi({
      'GET /api/inbox': () => list(approved ? [] : [item('n1', { readAt: 'x' })]),
      'POST /api/teams/acme/web/builds/12/review': () => {
        approved = true
        return { body: { build: {} } }
      },
    })
    await show()
    await expect.element(page.getByRole('button', { name: /Approve all/ })).toBeVisible()
    await userEvent.keyboard('{Shift>}A{/Shift}')
    await expect.poll(() => api.of('POST')[0]?.body).toEqual({ state: 'approved' })
    await expectEmptyState("You're all caught up", {
      body: 'Reviews, mentions and decisions for you appear here.',
      tone: 'success',
    })
    // The list is empty, so the pane has nothing to invite a choice of.
    await expect.element(page.getByText('Select a notification')).not.toBeInTheDocument()
  })

  it('has no Approve all for a notice without your open request', async () => {
    fakeApi({ 'GET /api/inbox': list([item('n1', { request: null })]) })
    await show()
    await expect.element(page.getByRole('button', { name: 'Snooze' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: /Approve all/ })).not.toBeInTheDocument()
  })

  it('replies to a mention from the pane', async () => {
    const api = fakeApi({
      'GET /api/inbox': list([
        item('n1', { kind: 'mentioned', payload: { snippet: 'Is it 2px?', commentId: 'c1' } }),
      ]),
      'POST /api/teams/acme/web/builds/12/comments': { status: 201, body: { id: 'c2' } },
    })
    await show()
    await page.getByRole('textbox', { name: 'Reply' }).fill('Yes, 2px')
    await page.getByRole('button', { name: 'Reply', exact: true }).click()
    await expect.poll(() => api.of('POST')[0]?.body).toEqual({ body: 'Yes, 2px', parentId: 'c1' })
  })

  it('has no reply box on a notice that is not a mention', async () => {
    fakeApi({ 'GET /api/inbox': list([item('n1')]) })
    await show()
    await expect.element(page.getByRole('textbox', { name: 'Reply' })).not.toBeInTheDocument()
  })

  it('counts the Snoozed tab beside its name', async () => {
    // Both tabs answer with the same two notifications here: the count is the snoozed tab's.
    fakeApi({ 'GET /api/inbox': list([item('n1'), item('n2')]) })
    await show()
    await expect.element(page.getByRole('tab', { name: 'Snoozed 2' })).toBeVisible()
  })

  it('marks everything read', async () => {
    const api = fakeApi({
      'GET /api/inbox': list([item('n1'), item('n2')]),
      'POST /api/inbox/read-all': { body: { marked: 2 } },
    })
    await show()
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
    await expectEmptyState("You're all caught up", {
      body: 'Reviews, mentions and decisions for you appear here.',
      tone: 'success',
      centred: true,
    })
    await expect.element(page.getByText('Select a notification')).not.toBeInTheDocument()
  })

  it.each([
    ['everything', 'Nothing here yet', 'Every notification you get appears here.'],
    ['snoozed', 'Nothing snoozed', 'Notifications you put off wait here until they wake.'],
  ])('says what the %s tab holds when it is empty', async (tab, title, body) => {
    fakeApi({ 'GET /api/inbox': list([], tab) })
    await show(`/inbox?tab=${tab}`)
    await expectEmptyState(title, { body })
  })

  it('finds notifications by text, team or build, keeps the text in the address and clears it with Esc', async () => {
    fakeApi({
      'GET /api/inbox': list([
        item('n1'),
        item('n2', {
          kind: 'build_rejected',
          actor: { id: 'u3', name: 'Grace', image: null },
          payload: { reason: 'Logo moved' },
          team: { slug: 'docs', name: 'Docs' },
          build: { ...item('x').build, number: 13, branch: 'feature/logo' },
        }),
      ]),
    })
    const { router } = await show()
    const rows = page.getByRole('list', { name: 'For you' })
    const find = page.getByRole('textbox', { name: 'Find notifications' })
    await expect.element(find).toHaveAttribute('placeholder', 'Find notifications')
    await userEvent.keyboard('/')
    await expect.element(find).toHaveFocus()
    await userEvent.type(find, 'logo')
    await expect.element(rows.getByText('Grace rejected build #13')).toBeVisible()
    await expect
      .element(rows.getByText('Ada requested your review of build #12'))
      .not.toBeInTheDocument()
    await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'logo' }))
    await userEvent.fill(find, 'docs')
    await expect.element(rows.getByText('Grace rejected build #13')).toBeVisible()
    await userEvent.fill(find, '#12')
    await expect.element(rows.getByText('Ada requested your review of build #12')).toBeVisible()
    await userEvent.fill(find, 'nothing here')
    await expectEmptyState('No notification matches “nothing here”', { action: 'Clear search' })
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect.element(find).toHaveValue('')
    await userEvent.fill(find, 'nothing here')
    await userEvent.keyboard('{Escape}')
    await expect.element(find).toHaveValue('')
    await expect.element(rows.getByText('Grace rejected build #13')).toBeVisible()
    await vi.waitFor(() => expect(router.state.location.search).not.toHaveProperty('q'))
  })

  it('opens with the find text and the notification of the address', async () => {
    fakeApi({
      'GET /api/inbox': list([item('n1'), item('n2', { kind: 'build_approved' })], 'everything'),
    })
    await show('/inbox?tab=everything&item=n2&q=approved')
    await expect
      .element(page.getByRole('textbox', { name: 'Find notifications' }))
      .toHaveValue('approved')
    // The row, and the same words as the pane's title: the notification of the address is selected.
    await expect.poll(() => page.getByText('Ada approved build #12').elements().length).toBe(2)
    expect(page.getByText('Ada requested your review of build #12').elements()).toHaveLength(0)
  })
})

describe('InboxPage pane width', () => {
  it('has a handle that resizes the notification pane', async () => {
    fakeApi({ 'GET /api/inbox': list([item('n1')]) })
    await renderPage(<InboxPage />, {
      route: '/inbox',
      url: '/inbox',
      announcer: true,
      validateSearch: validateInboxSearch,
      viewport: [1400, 900],
    })
    const pane = page.getByRole('region', { name: 'Notification' })
    await expect.element(pane).toBeVisible()
    await expectResize(
      page.getByRole('separator', { name: 'Resize the notification pane' }),
      'inbox-pane',
      () => pane.element().getBoundingClientRect().width,
      { dx: -80, grows: -1 },
    )
  })
})
