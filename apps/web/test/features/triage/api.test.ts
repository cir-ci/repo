import type { Triage } from '@circi/api'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import {
  flatten,
  frameOf,
  snapshotHistoryQuery,
  groupItems,
  itemName,
  queueCount,
  rotationText,
  sinceText,
  snoozeBody,
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
    expect(queueCount(groups)).toBe('3 items to triage')
    expect(queueCount([])).toBe('Nothing to triage')
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
    expect(sinceText(at, t(20_000))).toBe('Waiting under a minute')
    expect(sinceText(at, t(3 * 3600_000))).toBe('Waiting 3 hours')
    expect(sinceText(at, t(24 * 3600_000))).toBe('Waiting 1 day')
    expect(sinceText(at, t(15 * 24 * 3600_000))).toBe('Waiting 2 weeks')
  })

  it('words the rotation chip', () => {
    const rotation = { members: [], onTriage: { id: 'u', name: 'Ada' }, until: null }
    expect(rotationText(rotation)).toBe('On triage: Ada')
    expect(rotationText({ ...rotation, onTriage: null })).toBeUndefined()
  })
})

describe('optimistic updates', () => {
  const queue: Triage.Queue = {
    items: [item({ key: 'a' }), item({ key: 'b' })],
    rotation: { members: [], onTriage: null, until: null },
  }
  it('removes an item or sets its assignee, leaving the rest', () => {
    expect(withoutItem(queue, { kind: 'flaky', key: 'a' }).items.map((i) => i.key)).toEqual(['b'])
    const next = withAssignee(queue, { kind: 'flaky', key: 'b' }, { id: 'u', name: 'Ada' })
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

const entry = (
  status: 'changed' | 'unchanged' | null,
  image: { sha256: string; thumbnail: string | null } | null,
  reviewStatus: 'pending' | 'approved' = 'pending',
) => ({
  build: {
    number: 7,
    branch: 'main',
    status: 'complete' as const,
    reviewStatus,
    createdAt: '2026-11-08T10:00:00.000Z',
  },
  status,
  image: image && { ...image, width: 10, height: 20 },
})

describe('filmstrip', () => {
  it('gives a changed screenshot of a flaky item the flaky glyph', () => {
    const changed = entry('changed', { sha256: 'h', thumbnail: 't' })
    expect(frameOf(changed, 'flaky')).toMatchObject({
      number: 7,
      status: 'flaky',
      label: 'Flaky',
      src: '/api/files/t',
      sha256: 'h',
      width: 10,
      height: 20,
    })
    expect(frameOf(changed, 'no_baseline').status).toBe('needs-review')
    expect(frameOf(entry('unchanged', { sha256: 'h', thumbnail: null }), 'flaky')).toMatchObject({
      status: 'neutral',
      src: '/api/files/h',
    })
  })

  it('has no image for a build that has none, and reads a not yet compared snapshot as unchanged', () => {
    expect(frameOf(entry(null, null), 'flaky')).toMatchObject({ src: null, sha256: null })
  })
})

describe('snapshotHistoryQuery', () => {
  it('asks for the history anchored on the item’s build, with the name escaped', async () => {
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
