import type { Inbox } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  withAllRead,
  withBuildApproved,
  withoutNotification,
  withRead,
  withSnoozedNotification,
  withUnsnoozedNotification,
} from '#features/inbox/optimistic.ts'

const now = new Date('2026-11-16T10:00:00.000Z')
const item = (id: string, over: Partial<Inbox.Item> = {}): Inbox.Item => ({
  id,
  kind: 'review_requested',
  createdAt: '2026-11-08T10:00:00.000Z',
  readAt: null,
  snoozedUntil: null,
  payload: {},
  actor: null,
  build: {
    number: 12,
    name: 'default',
    branch: 'main',
    prNumber: null,
    commitSha: 'abc',
    status: 'complete',
    reviewStatus: 'pending',
  },
  changes: null,
  request: { dueAt: null, overdueByMs: 0 },
  project: { slug: 'web', name: 'Web' },
  workspace: { slug: 'acme', name: 'Acme' },
  alsoInReviews: false,
  ...over,
})
const list = (items: Inbox.Item[], tab: Inbox.Tab = 'for-you'): Inbox.List => ({
  tab,
  unread: items.filter((i) => !i.readAt).length,
  items,
})

describe('inbox patches', () => {
  it('marks read and unread, moving the unread count', () => {
    const read = withRead(list([item('a'), item('b')]), 'a', true, now)
    expect(read.unread).toBe(1)
    expect(read.items[0]?.readAt).toBe(now.toISOString())
    const back = withRead(read, 'a', false, now)
    expect(back.unread).toBe(2)
    expect(back.items[0]?.readAt).toBeNull()
  })

  it('changes nothing when the state already matches or the item is not there', () => {
    const l = list([item('a', { readAt: '2026-11-09T00:00:00.000Z' })])
    expect(withRead(l, 'a', true, now)).toBe(l)
    expect(withRead(l, 'zzz', false, now)).toBe(l)
  })

  it('removes a notification and drops the count only for an unread one', () => {
    const l = list([item('a'), item('b', { readAt: '2026-11-09T00:00:00.000Z' })])
    expect(withoutNotification(l, 'a')).toMatchObject({ unread: 0, items: [{ id: 'b' }] })
    expect(withoutNotification(l, 'b').unread).toBe(1)
  })

  it('marks everything read', () => {
    const all = withAllRead(list([item('a'), item('b')]), now)
    expect(all.unread).toBe(0)
    expect(all.items.every((i) => i.readAt === now.toISOString())).toBe(true)
  })

  it('snoozes out of every tab but Snoozed, and unsnoozes out of Snoozed only', () => {
    expect(withSnoozedNotification(list([item('a')]), 'a').items).toEqual([])
    const snoozed = list([item('a')], 'snoozed')
    expect(withSnoozedNotification(snoozed, 'a')).toBe(snoozed)
    expect(withUnsnoozedNotification(snoozed, 'a').items).toEqual([])
    const forYou = list([item('a')])
    expect(withUnsnoozedNotification(forYou, 'a')).toBe(forYou)
  })

  it('marks the build approved on every notice about it, ending the request', () => {
    const l = list([item('a'), item('b', { build: { ...item('x').build!, number: 13 } })])
    const next = withBuildApproved(l, { workspace: 'acme', project: 'web', number: 12 })
    expect(next.items[0]).toMatchObject({ request: null, build: { reviewStatus: 'approved' } })
    expect(next.items[1]?.build?.reviewStatus).toBe('pending')
  })
})
