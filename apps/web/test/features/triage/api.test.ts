import type { Triage } from '@circi/api'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import {
  blockingText,
  changedText,
  flatten,
  snapshotHistoryQuery,
  groupItems,
  itemName,
  itemSubtitle,
  rotationText,
  snoozeBody,
  waitingFor,
  withAssignee,
  withoutItem,
} from '#features/triage/api.ts'

const item = (over: Partial<Triage.Item> = {}): Triage.Item => ({
  kind: 'flaky',
  key: 'home',
  snapshotName: 'home',
  team: { slug: 'web', name: 'Web' },
  build: {
    number: 12,
    branch: 'main',
    commitSha: 'abc',
    status: 'complete',
    createdAt: '2026-11-08T10:00:00.000Z',
  },
  assignee: null,
  snoozedUntil: null,
  snoozeKind: null,
  snoozed: false,
  history: [],
  reason: null,
  error: null,
  blocking: 0,
  ...over,
})

describe('groupItems', () => {
  it('orders groups Flaky, No baseline, Failed, drops empty ones and set-aside snoozed items', () => {
    const groups = groupItems([
      item({ kind: 'failed', key: 'build:3', snapshotName: null }),
      item({ key: 'a' }),
      item({ kind: 'no_baseline', key: 'b' }),
      item({ key: 'c', snoozed: true }),
    ])
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ['Flaky', 1],
      ['No baseline', 1],
      ['Failed', 1],
    ])
    expect(groupItems([]).length).toBe(0)
    expect(flatten(groups).map((i) => i.key)).toEqual(['a', 'b', 'build:3'])
  })
})

describe('labels', () => {
  it('names a row by kind, snapshot, build and branch', () => {
    expect(itemName(item())).toBe('Flaky, home, build #12, main')
    expect(itemName(item({ kind: 'failed', snapshotName: null, key: 'build:12' }))).toBe(
      'Failed, Build #12, main',
    )
  })

  it('says how long an item has waited', () => {
    const at = '2026-11-08T10:00:00.000Z'
    const t = (ms: number) => new Date(at).getTime() + ms
    expect(waitingFor(at, t(20_000))).toBe('under a minute')
    expect(waitingFor(at, t(3 * 3600_000))).toBe('3 hours')
    expect(waitingFor(at, t(24 * 3600_000))).toBe('1 day')
    expect(waitingFor(at, t(15 * 24 * 3600_000))).toBe('2 weeks')
  })

  it('words the rotation chip with the day the turn passes on', () => {
    const rotation = { members: [], onTriage: { id: 'u', name: 'Ada', image: null }, until: null }
    expect(rotationText(rotation)).toBe('On triage: Ada')
    // 2026-11-16 is a Monday; noon keeps the weekday the same in every time zone.
    expect(rotationText({ ...rotation, until: '2026-11-16T12:00:00.000Z' })).toBe(
      'On triage: Ada until Mon',
    )
    expect(rotationText({ ...rotation, onTriage: null })).toBeUndefined()
  })

  it("words a row's second line and the pane's Blocking row per kind", () => {
    const history = [3, 4, 5, 6].map((number) => ({ number, changed: number % 2 === 0 }))
    expect(changedText(history)).toBe('Changed in 2 of the last 4 builds')
    // Without a reason, the history says it; with one, the subtitle is the reason.
    expect(itemSubtitle(item({ history }))).toBe('Changed in 2 of the last 4 builds')
    const flipFlop = { count: 3, threshold: 3, window: 10, returns: [] }
    expect(itemSubtitle(item({ history, reason: { kind: 'flip_flop', flipFlop } }))).toBe(
      'Came back to an earlier image 3 times',
    )
    expect(itemSubtitle(item({ kind: 'no_baseline' }))).toBe('First seen in build #12')
    expect(itemSubtitle(item({ kind: 'failed', error: '2 files over the limit' }))).toBe(
      '2 files over the limit',
    )
    expect(itemSubtitle(item({ kind: 'failed' }))).toBe('The build failed')
    expect(blockingText(item({ blocking: 0 }))).toBe('Nothing')
    expect(blockingText(item({ blocking: 1 }))).toBe('1 pull request shows it as changed')
    expect(blockingText(item({ blocking: 3 }))).toBe('3 pull requests show it as changed')
    expect(blockingText(item({ kind: 'failed' }))).toBe('The check on this commit is failing')
  })
})

describe('optimistic updates', () => {
  const queue: Triage.Queue = {
    items: [item({ key: 'a' }), item({ key: 'b' })],
    rotation: { members: [], onTriage: null, until: null },
  }
  it('removes an item or sets its assignee, leaving the rest', () => {
    expect(withoutItem(queue, { kind: 'flaky', key: 'a' }).items.map((i) => i.key)).toEqual(['b'])
    const next = withAssignee(
      queue,
      { kind: 'flaky', key: 'b' },
      { id: 'u', name: 'Ada', image: null, auto: false },
    )
    expect(next.items.map((i) => i.assignee?.name)).toEqual([undefined, 'Ada'])
    expect(queue.items[1]?.assignee).toBeNull()
  })

  it('maps a snooze choice to the route body', () => {
    const ref = { kind: 'flaky' as const, key: 'a' }
    expect(snoozeBody(ref, { kind: 'next_push' })).toEqual({ ...ref, choice: 'next_push' })
    expect(snoozeBody(ref, { kind: 'date', date: 'D' })).toEqual({
      ...ref,
      choice: 'date',
      date: 'D',
    })
  })
})

describe('snapshotHistoryQuery', () => {
  it("asks for the history anchored on the item's build, with the name escaped", async () => {
    let asked = ''
    vi.stubGlobal('fetch', async (path: string) => {
      asked = path
      return Response.json({ defaultBranch: 'main', default: [], branch: null })
    })
    await new QueryClient().fetchQuery(snapshotHistoryQuery('acme', 'web', 'checkout/home', 12))
    expect(asked).toBe('/api/teams/acme/web/snapshots/checkout%2Fhome/history?limit=5&build=12')
    vi.unstubAllGlobals()
  })
})
