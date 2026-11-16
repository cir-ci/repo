import type { Review } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  withoutRequest,
  withRequestAwake,
  withRequestClosed,
  withRequestSnoozed,
} from '#features/reviews/optimistic.ts'

const req = (id: string): Review.Request => ({
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
  baseline: null,
  reviewer: { id: 'me', name: 'Me', image: null },
  requestedBy: null,
  requestedByName: null,
  build: {
    number: 1,
    name: 'default',
    branch: 'main',
    prNumber: null,
    commitSha: 'abc',
    status: 'complete',
    conclusion: 'changes_detected',
    reviewStatus: 'pending',
  },
  project: { slug: 'web', name: 'Web', diffThreshold: 0.01 },
  workspace: { slug: 'acme', name: 'Acme' },
  changes: { changed: 1, added: 0, removed: 0, unchanged: 0, failed: 0 },
  changedScreenshots: [],
  flakyChanges: 0,
})
const list = (tab: Review.Tab, ids: string[]): Review.List => ({ tab, requests: ids.map(req) })
const ids = (l: Review.List) => l.requests.map((r) => r.id)

describe('review request patches', () => {
  it('an answered request leaves every tab but Reviewed', () => {
    expect(ids(withRequestClosed(list('for-you', ['a', 'b']), 'a'))).toEqual(['b'])
    const reviewed = list('reviewed', ['a'])
    expect(withRequestClosed(reviewed, 'a')).toBe(reviewed)
  })

  it('a dismissed request is gone', () => {
    expect(ids(withoutRequest(list('all-open', ['a', 'b']), 'b'))).toEqual(['a'])
  })

  it('a snooze drops it from For you and marks it elsewhere', () => {
    expect(withRequestSnoozed(list('for-you', ['a']), 'a', { kind: 'tomorrow' }).requests).toEqual(
      [],
    )
    const shown = withRequestSnoozed(list('all-open', ['a']), 'a', {
      kind: 'date',
      date: '2026-12-01T09:00:00.000Z',
    })
    expect(shown.requests[0]).toMatchObject({
      snoozeKind: 'date',
      snoozedUntil: '2026-12-01T09:00:00.000Z',
    })
    const soon = withRequestSnoozed(list('created', ['a']), 'a', { kind: 'next_week' })
    expect(soon.requests[0]).toMatchObject({ snoozeKind: 'next_week', snoozedUntil: null })
  })

  it('bringing it back removes it from Snoozed and clears the snooze elsewhere', () => {
    expect(withRequestAwake(list('snoozed', ['a']), 'a').requests).toEqual([])
    const l = list('all-open', ['a'])
    l.requests[0] = {
      ...req('a'),
      snoozeKind: 'tomorrow',
      snoozedUntil: '2026-11-17T09:00:00.000Z',
    }
    expect(withRequestAwake(l, 'a').requests[0]).toMatchObject({
      snoozeKind: null,
      snoozedUntil: null,
    })
  })
})
