import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { validateReviewsSearch } from '#features/reviews/api.ts'
import { ReviewsPage } from '#features/reviews/ReviewsPage.tsx'
import { fakeFetch } from '#test/support/fetch.ts'
import { gate } from '#test/support/gate.ts'
import { renderPage } from '#test/support/render.tsx'
import { toastNamed } from '#test/support/toast.ts'

// This file drives the real better-auth client over the faked network, not the fake client `setup.ts` installs.
vi.unmock('#lib/auth-client.ts')

const request = (id: string, number: number) => ({
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
  changes: { changed: 4, added: 1, removed: 0, unchanged: 38, failed: 0 },
  changedScreenshots: [],
})

const rowFor = (n: number) => page.getByRole('link', { name: new RegExp(`Build #${n}`) }).first()

describe('Reviews optimistic updates', () => {
  it('takes an approved request off the list before the server answers, and puts it back when the server refuses', async () => {
    const held = gate()
    fakeFetch({
      'GET /api/auth/get-session': {
        session: { id: 's1', userId: 'me', expiresAt: '2099-01-01T00:00:00.000Z', token: 't' },
        user: { id: 'me', name: 'Me', email: 'me@example.test', emailVerified: true },
      },
      'GET /api/reviews': { tab: 'for-you', requests: [request('r1', 12)] },
      'POST /api/projects/acme/web/builds/12/review': () => held.reply,
    })
    await renderPage(<ReviewsPage />, {
      viewport: [1280, 800],
      route: '/workspaces/$workspace/reviews',
      url: '/workspaces/acme/reviews',
      announcer: true,
      otherRoutes: ['/$workspace/$project/builds/$number'],
      validateSearch: validateReviewsSearch,
    })
    await rowFor(12).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Approve' }).click()
    await expect.element(rowFor(12)).not.toBeInTheDocument()
    held.refuse()
    await expect.element(toastNamed(/Couldn't approve/)).toBeVisible()
    await expect.element(rowFor(12)).toBeVisible()
  })
})
