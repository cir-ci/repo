import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { validateInboxSearch } from '#features/inbox/api.ts'
import { InboxPage } from '#features/inbox/InboxPage.tsx'
import { fakeFetch } from '#test/support/fetch.ts'
import { gate } from '#test/support/gate.ts'
import { renderPage } from '#test/support/render.tsx'
import { toastNamed } from '#test/support/toast.ts'

const item = (id: string) => ({
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
})

const row = () =>
  page.getByRole('list', { name: 'For you' }).getByText('Ada requested your review of build #12')

const show = () =>
  renderPage(<InboxPage />, {
    route: '/inbox',
    url: '/inbox',
    announcer: true,
    validateSearch: validateInboxSearch,
  })

describe('Inbox optimistic updates', () => {
  it('removes a notification before the server answers, and brings it back when the server refuses', async () => {
    const held = gate()
    fakeFetch({
      'GET /api/inbox': { tab: 'for-you', unread: 1, items: [item('n1')] },
      'DELETE /api/inbox/n1': () => held.reply,
    })
    await show()
    await expect.element(row()).toBeVisible()
    await userEvent.keyboard('{Backspace}')
    // The server has not answered: the row is already gone.
    await expect.element(row()).not.toBeInTheDocument()
    held.refuse()
    await expect.element(toastNamed(/Couldn't remove the notice/)).toBeVisible()
    await expect.element(row()).toBeVisible()
  })
})
