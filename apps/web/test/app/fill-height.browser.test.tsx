import { AppFrame } from '@circi/ui'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { BuildPage } from '#features/builds/BuildPage.tsx'
import { validateBuildSearch } from '#features/builds/search.ts'
import { validateInboxSearch } from '#features/inbox/api.ts'
import { InboxPage } from '#features/inbox/InboxPage.tsx'
import { validateReviewsSearch } from '#features/reviews/api.ts'
import { ReviewsPage } from '#features/reviews/ReviewsPage.tsx'
import { detail, fakeBuildApi } from '#test/features/builds/fake-build-api.tsx'
import { mockAuthClient } from '#test/support/auth-client.ts'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

mockAuthClient()

// A page's panes reach the bottom of the panel at every width: the panel itself reaches the bottom
// of the viewport (less the frame's 8px margin), and the panes in it reach the panel's bottom.
const MARGIN = 8
const TOLERANCE = 2

const framed = (children: ReactNode) => (
  <AppFrame sidebar={<span>Side</span>} compactBar={<span>Bar</span>}>
    {children}
  </AppFrame>
)

const bottom = (el: Element) => el.getBoundingClientRect().bottom

function panelBottom() {
  const main = page.getByRole('main').element()
  expect(bottom(main)).toBeGreaterThanOrEqual(window.innerHeight - MARGIN - TOLERANCE)
  return bottom(main)
}

/** The laid-out children, without the resize handles (they float over the split). */
const layoutChildren = (el: Element) =>
  [...el.children].filter((child) => !child.hasAttribute('data-pane'))

/** How far above the panel's bottom the element ends (0 when it reaches it). */
const gapToBottom = (el: Element | null | undefined) => {
  expect(el).toBeTruthy()
  return panelBottom() - bottom(el!)
}

describe('the build page', () => {
  it.each([
    [1280, 900],
    [1000, 2400],
    [900, 2400],
  ] as [number, number][])('fills the panel to the bottom at %ix%i', async (width, height) => {
    fakeBuildApi(detail())
    await renderPage(framed(<BuildPage />), {
      viewport: [width, height],
      route: '$workspace/$project/builds/$number',
      url: '/acme/web-app/builds/7',
      announcer: true,
      validateSearch: validateBuildSearch,
    })
    const rail = page.getByRole('navigation', { name: 'Screenshots' })
    await expect.element(rail).toBeVisible()
    const [list, viewer, sidebar] = layoutChildren(rail.element().parentElement!)
    // The viewer fills its row; where the sidebar sits under it, the sidebar closes the column.
    expect(gapToBottom(width >= 1100 ? viewer : sidebar)).toBeLessThanOrEqual(TOLERANCE)
    expect(bottom(list!)).toBeLessThanOrEqual(bottom(viewer!) + TOLERANCE)
  })

  it('closes the panel with the review bar on a phone, at 390x2400', async () => {
    fakeBuildApi(detail())
    await renderPage(framed(<BuildPage />), {
      viewport: [390, 2400],
      route: '$workspace/$project/builds/$number',
      url: '/acme/web-app/builds/7',
      announcer: true,
      validateSearch: validateBuildSearch,
    })
    const bar = page.getByRole('group', { name: 'Review' })
    await expect.element(bar).toBeVisible()
    expect(gapToBottom(bar.element())).toBeLessThanOrEqual(TOLERANCE)
  })
})

describe('Reviews', () => {
  it.each([
    [1280, 800],
    [600, 800],
  ] as [number, number][])('fills the panel to the bottom at %ix%i', async (width, height) => {
    fakeApi({ 'GET /api/reviews': { body: { tab: 'for-you', requests: [] } } })
    await renderPage(framed(<ReviewsPage />), {
      viewport: [width, height],
      route: '/workspaces/$workspace/reviews',
      url: '/workspaces/acme/reviews',
      announcer: true,
      otherRoutes: ['/$workspace/$project/builds/$number'],
      validateSearch: validateReviewsSearch,
    })
    const layout = await vi.waitUntil(() => document.querySelector('main [class*="layout"]'))
    expect(gapToBottom(layout.firstElementChild)).toBeLessThanOrEqual(TOLERANCE)
  })
})

describe('Inbox', () => {
  it.each([
    [1280, 800],
    [700, 800],
  ] as [number, number][])('fills the panel to the bottom at %ix%i', async (width, height) => {
    fakeApi({ 'GET /api/inbox': { body: { tab: 'for-you', unread: 0, items: [] } } })
    await renderPage(framed(<InboxPage />), {
      viewport: [width, height],
      route: '/inbox',
      url: '/inbox',
      announcer: true,
      validateSearch: validateInboxSearch,
    })
    const split = await vi.waitUntil(() => document.querySelector('main [class*="split"]'))
    expect(gapToBottom(split)).toBeLessThanOrEqual(TOLERANCE)
  })
})

describe('Inbox with a notification open', () => {
  it('stacks the pane under the list at 900x800, the pane no taller than 60% and the list taking the rest', async () => {
    const note = {
      id: 'n1',
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
    }
    fakeApi({ 'GET /api/inbox': { body: { tab: 'everything', unread: 1, items: [note] } } })
    await renderPage(framed(<InboxPage />), {
      viewport: [900, 800],
      route: '/inbox',
      url: '/inbox?tab=everything&item=n1',
      announcer: true,
      validateSearch: validateInboxSearch,
    })
    const split = await vi.waitUntil(() => document.querySelector('main [class*="split"]'))
    await vi.waitUntil(() => layoutChildren(split).length === 2)
    const [list, pane] = layoutChildren(split)
    expect(gapToBottom(pane)).toBeLessThanOrEqual(TOLERANCE)
    const area = split.getBoundingClientRect().height
    expect(pane!.getBoundingClientRect().height).toBeLessThanOrEqual(area * 0.6 + TOLERANCE)
    expect(list!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      pane!.getBoundingClientRect().top + TOLERANCE,
    )
  })
})
