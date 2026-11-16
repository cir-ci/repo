import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { validateInboxSearch } from '#features/inbox/api.ts'
import { InboxPage } from '#features/inbox/InboxPage.tsx'
import { PANES } from '#lib/panes.ts'
import { usePaneStore } from '#lib/stores/pane-store.ts'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { fakeApi } from '#test/support/fetch.ts'
import { pageHeader } from '#test/support/header.ts'
import { menuItemNames } from '#test/support/menu.ts'
import { expectNoSidewaysScroll } from '#test/support/overflow.ts'
import { expectOnePrimaryPerArea } from '#test/support/primary-buttons.ts'
import { renderPage } from '#test/support/render.tsx'
import { expectLimitedToSpace, expectResize, parentOf } from '#test/support/resize.ts'
import { openDialogs, toastNamed } from '#test/support/toast.ts'

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
  changes: { changed: 4, added: 1, removed: 0, unchanged: 38, failed: 0 },
  request: { dueAt: null, overdueByMs: 0 },
  project: { slug: 'web', name: 'Web' },
  workspace: { slug: 'acme', name: 'Acme' },
  alsoInReviews: false,
  ...over,
})

const list = (items: { readAt?: string | null }[], tab = 'for-you') => ({
  body: {
    tab,
    unread: items.filter((i) => !i.readAt).length,
    items,
  },
})

const show = (url = '/inbox') =>
  renderPage(<InboxPage />, {
    route: '/inbox',
    url,
    announcer: true,
    validateSearch: validateInboxSearch,
  })

describe('InboxPage', () => {
  it('words each row (no Also in Reviews chip, the build number in the meta line) and flags unread ones', async () => {
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
    expect(rows.getByText('Also in Reviews').elements()).toHaveLength(0)
    await expect.element(rows.getByText('#12')).toBeVisible()
    await expect.element(rows.getByText('Unread.')).toBeInTheDocument()
    await expect.element(rows.getByText('Ada rejected build #13')).toBeVisible()
    await expect.element(rows.getByText('Logo moved')).toBeVisible()
    await expect
      .element(page.getByRole('status').getByText('2 notifications, 1 unread'))
      .toBeVisible()
    await expect.element(page.getByRole('tablist', { name: 'Inbox' })).toBeVisible()
  })

  it('keeps the Also in Reviews chip in the pane without the sentence explaining it, and rows with a compact age', async () => {
    fakeApi({ 'GET /api/inbox': list([item('n1', { alsoInReviews: true })]) })
    await show('/inbox?item=n1')
    await expect
      .element(page.getByRole('heading', { name: /requested your review/ }).first())
      .toBeVisible()
    await expect.element(page.getByText('Also in Reviews')).toBeVisible()
    expect(document.body.textContent).not.toContain('clears it there')
    const rows = page.getByRole('list', { name: 'For you' })
    await expect.element(rows.getByText(/^\d+(m|h|d|w|mo|y)$|^now$/)).toBeVisible()
  })

  it("gives a connection notice a Reconnect button that opens that integration's settings page", async () => {
    fakeApi({
      'GET /api/inbox': list([
        item('n1', {
          kind: 'connection_needs_attention',
          actor: null,
          build: null,
          changes: null,
          request: null,
          project: null,
          payload: { integrationId: 'i7', integrationKind: 'slack', name: 'Acme Slack' },
        }),
      ]),
    })
    await show('/inbox?item=n1')
    const reconnect = page.getByRole('link', { name: 'Reconnect' })
    await expect.element(reconnect).toBeVisible()
    await expect
      .element(reconnect)
      .toHaveAttribute('href', '/workspaces/acme/settings/integrations/slack/i7')
    expectOnePrimaryPerArea()
  })

  it('fits a long mention beside the open notification: the list gives way, nothing runs past the panel', async () => {
    await page.viewport(1300, 800)
    const snippet = `@owner ${'this needs another look before we ship it, '.repeat(12)}`
    fakeApi({
      'GET /api/inbox': list([item('n1', { kind: 'mentioned', payload: { snippet } })]),
    })
    await show('/inbox?item=n1')
    const pane = page.getByRole('heading', { name: /mentioned you on/ })
    await expect.element(pane.first()).toBeVisible()
    // The list and the pane stay inside the page's width (no wider than the window here), so the
    // pane isn't clipped at the panel's edge.
    const split = document.querySelector<HTMLElement>('[class*="split"]')!
    expect(split.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth)
    expect(split.scrollWidth).toBeLessThanOrEqual(split.clientWidth)
  })

  it('keeps every footer action inside the pane at its narrowest width', async () => {
    await page.viewport(1440, 800)
    usePaneStore.setState({ widths: { 'inbox-pane': PANES['inbox-pane'].min } })
    fakeApi({ 'GET /api/inbox': list([item('n1')]) })
    await show('/inbox?item=n1')
    const pane = page.getByRole('region', { name: 'Notification' })
    await expect.element(pane.getByRole('button', { name: /Approve all/ })).toBeVisible()
    const card = pane.element().getBoundingClientRect()
    expect(card.width).toBeLessThanOrEqual(PANES['inbox-pane'].min)
    const buttons = [...pane.element().querySelectorAll('footer button, footer a')]
    expect(buttons.length).toBeGreaterThanOrEqual(5)
    for (const button of buttons) {
      const box = button.getBoundingClientRect()
      expect(box.left).toBeGreaterThanOrEqual(card.left)
      expect(box.right).toBeLessThanOrEqual(card.right)
    }
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

  it('says Marked as read in a toast, and Undo puts it back', async () => {
    let readAt: string | null = null
    const api = fakeApi({
      'GET /api/inbox': () => list([item('n1', { readAt })]),
      'POST /api/inbox/n1/read': () => {
        readAt = '2026-11-08T12:00:00.000Z'
        return {
          body: { id: 'n1', readAt, snoozedUntil: null, undo: { id: 'nu1', expiresAt: '2099' } },
        }
      },
      'POST /api/inbox/undo/nu1': () => {
        readAt = null
        return { body: { undone: true } }
      },
    })
    await show()
    await expect.element(page.getByRole('button', { name: 'Mark read' })).toBeVisible()
    await userEvent.keyboard('u')
    await expect.element(toastNamed('Marked as read')).toBeVisible()
    await toastNamed('Marked as read').getByRole('button', { name: 'Undo' }).click()
    await expect.element(toastNamed('Undone')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Mark read' })).toBeVisible()
    expect(api.of('POST').map((c) => c.path)).toEqual(['/api/inbox/n1/read', '/api/inbox/undo/nu1'])
  })

  it('names the failure in a toast when marking read fails', async () => {
    fakeApi({
      'GET /api/inbox': list([item('n1')]),
      'POST /api/inbox/n1/read': { status: 500, body: { error: 'boom' } },
    })
    await show()
    await expect.element(page.getByRole('button', { name: 'Mark read' })).toBeVisible()
    await userEvent.keyboard('u')
    await expect.element(toastNamed("Couldn't change the notice")).toBeVisible()
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
        return { body: { undo: { id: 'u-n1', expiresAt: '2099-01-01T00:00:00.000Z' } } }
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
    // Removing acts at once; the toast offers Undo instead of a confirmation.
    await expect.element(toastNamed('Removed')).toBeVisible()
    await expect.element(toastNamed('Removed').getByRole('button', { name: 'Undo' })).toBeVisible()
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
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web/builds/12')
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
      'POST /api/projects/acme/web/builds/12/review': () => {
        approved = true
        return { body: { build: {} } }
      },
    })
    await show()
    await expect.element(page.getByRole('button', { name: /Approve all/ })).toBeVisible()
    // "Open review" is the primary action; Approve all (it approves unseen) is secondary.
    await expect
      .element(page.getByRole('link', { name: 'Open review' }))
      .toHaveAttribute('data-variant', 'primary')
    await expect
      .element(page.getByRole('button', { name: /Approve all/ }))
      .not.toHaveAttribute('data-variant', 'primary')
    expectOnePrimaryPerArea()
    await userEvent.keyboard('{Shift>}A{/Shift}')
    await expect.poll(() => api.of('POST')[0]?.body).toEqual({ state: 'approved' })
    await expectEmptyState("You're all caught up", {
      body: 'Notifications about requests, mentions and decisions appear here.',
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
      'POST /api/projects/acme/web/builds/12/comments': { status: 201, body: { id: 'c2' } },
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
      body: 'Notifications about requests, mentions and decisions appear here.',
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

  it('finds notifications by text, project or build, keeps the text in the address and clears it with Esc', async () => {
    fakeApi({
      'GET /api/inbox': list([
        item('n1'),
        item('n2', {
          kind: 'build_rejected',
          actor: { id: 'u3', name: 'Grace', image: null },
          payload: { reason: 'Logo moved' },
          project: { slug: 'docs', name: 'Docs' },
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

describe('InboxPage pane in a narrow window', () => {
  it('leaves the list its space, whatever width is stored', async () => {
    fakeApi({ 'GET /api/inbox': list([item('n1')]) })
    await renderPage(<InboxPage />, {
      route: '/inbox',
      url: '/inbox',
      announcer: true,
      validateSearch: validateInboxSearch,
      viewport: [1200, 800],
    })
    usePaneStore.setState({ widths: { 'inbox-pane': PANES['inbox-pane'].max } })
    const pane = page.getByRole('region', { name: 'Notification' })
    await expect.element(pane).toBeVisible()
    const handle = page.getByRole('separator', { name: 'Resize the notification pane' })
    const split = () => parentOf(handle.element())
    await expectLimitedToSpace(handle, 'inbox-pane', {
      pane: () => pane.element(),
      main: () => split().firstElementChild?.getBoundingClientRect().width ?? 0,
      container: split,
      grows: -1,
      to: 1120,
      gap: 8,
    })
  })
})

describe('InboxPage on a phone', () => {
  it('opens a tapped notification as a sheet over the list and closes it back to the list', async () => {
    await page.viewport(390, 844)
    fakeApi({ 'GET /api/inbox': list([item('n1'), item('n2')]) })
    await show()
    const rows = page.getByRole('list', { name: 'For you' })
    await expect
      .element(rows.getByText('Ada requested your review of build #12').first())
      .toBeVisible()
    // The first row is the cursor, but nothing opens until one is tapped.
    expect(openDialogs()).toHaveLength(0)
    expect(page.getByRole('region', { name: 'Notification' }).elements()).toHaveLength(0)
    for (const row of rows.getByRole('button').elements()) {
      expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(56)
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    await rows.getByRole('button').first().click()
    const sheet = page.getByRole('dialog', { name: 'Notification' })
    await expect.element(sheet).toBeVisible()
    await expect.element(sheet.getByRole('button', { name: 'Delete' })).toBeVisible()
    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect
      .poll(() => page.getByRole('dialog', { name: 'Notification' }).elements().length)
      .toBe(0)
  })
})

describe('InboxPage on a phone', () => {
  it('has compact header buttons and the find field full width below the header, with no sideways scroll', async () => {
    await page.viewport(390, 844)
    fakeApi({ 'GET /api/inbox': list([item('n1'), item('n2')]) })
    await show()
    const find = page.getByRole('textbox', { name: 'Find notifications' })
    await expect.element(find).toBeVisible()
    const header = pageHeader().getBoundingClientRect()
    const field = find.element().getBoundingClientRect()
    expect(field.top).toBeGreaterThanOrEqual(header.bottom - 1)
    expect(field.width).toBeGreaterThan(390 - 48)
    const mark = page
      .getByRole('button', { name: 'Mark all read' })
      .element()
      .getBoundingClientRect()
    expect(mark.height).toBeLessThanOrEqual(36.5)
    expect(header.height).toBeLessThanOrEqual(52)
    expectNoSidewaysScroll()
  })

  it('keeps the find field in the header on a desktop', async () => {
    await page.viewport(1280, 800)
    fakeApi({ 'GET /api/inbox': list([item('n1')]) })
    await show()
    const header = pageHeader()
    await expect.element(page.getByRole('textbox', { name: 'Find notifications' })).toBeVisible()
    expect(
      header.contains(page.getByRole('textbox', { name: 'Find notifications' }).element()),
    ).toBe(true)
  })
})

// The list's rows, not the breadcrumb's items above it.
const firstRow = () => page.getByRole('list', { name: 'For you' }).getByRole('listitem').first()

describe('right-click menu on an inbox item', () => {
  it('offers the row quick actions, with Approve all while the build awaits your review', async () => {
    fakeApi({ 'GET /api/inbox': list([item('n1')]) })
    await show()
    await firstRow().click({ button: 'right' })
    await expect
      .poll(() => menuItemNames())
      .toEqual([
        'Open',
        'Open in new tab',
        'Copy link',
        'Mark read',
        'Snooze until tomorrow',
        'Snooze until next week',
        'Approve all',
        'Delete',
      ])
  })

  it('has no Approve all for a notice without your open request', async () => {
    fakeApi({ 'GET /api/inbox': list([item('n1', { request: null })]) })
    await show()
    await firstRow().click({ button: 'right' })
    await expect.element(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
    expect(menuItemNames()).not.toContain('Approve all')
  })

  it('marks it read at once, and Undo puts it back', async () => {
    let readAt: string | null = null
    const api = fakeApi({
      'GET /api/inbox': () => list([item('n1', { readAt })]),
      'POST /api/inbox/n1/read': () => {
        readAt = '2026-11-08T12:00:00.000Z'
        return {
          body: { id: 'n1', readAt, snoozedUntil: null, undo: { id: 'nu1', expiresAt: '2099' } },
        }
      },
      'POST /api/inbox/undo/nu1': () => {
        readAt = null
        return { body: { undone: true } }
      },
    })
    await show()
    await firstRow().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Mark read' }).click()
    await expect.element(toastNamed('Marked as read')).toBeVisible()
    await toastNamed('Marked as read').getByRole('button', { name: 'Undo' }).click()
    await expect
      .poll(() => api.of('POST').map((c) => c.path))
      .toEqual(['/api/inbox/n1/read', '/api/inbox/undo/nu1'])
  })

  it('approves everything from the menu', async () => {
    const api = fakeApi({
      'GET /api/inbox': list([item('n1', { readAt: 'x' })]),
      'POST /api/projects/acme/web/builds/12/review': { body: { build: {} } },
    })
    await show()
    await firstRow().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Approve all' }).click()
    await expect.poll(() => api.of('POST')[0]?.body).toEqual({ state: 'approved' })
  })
})
