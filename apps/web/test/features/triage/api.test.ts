import type { Triage } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  filmstripNumbers,
  flatten,
  frameOf,
  groupItems,
  itemName,
  queueCount,
  regionToPixels,
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
  project: { slug: 'web', name: 'Web' },
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

describe('ignore regions', () => {
  it('turns fractions into a whole-number pixel rectangle', () => {
    expect(
      regionToPixels({ x: 0.1, y: 0.25, width: 0.5, height: 0.001 }, { width: 400, height: 300 }),
    ).toEqual({ x: 40, y: 75, width: 200, height: 1 })
    expect(regionToPixels({ x: 0, y: 0, width: 1, height: 1 }, { width: null, height: 1 })).toBe(
      undefined,
    )
  })
})

describe('filmstrip', () => {
  it('lists the build and the ones before it, newest first, never below 1', () => {
    expect(filmstripNumbers(12)).toEqual([12, 11, 10, 9, 8])
    expect(filmstripNumbers(2)).toEqual([2, 1])
  })

  it('gives a changed screenshot of a flaky item the flaky glyph', () => {
    const detail = {
      build: { number: 7, status: 'complete' as const, reviewStatus: 'pending' as const },
      diffs: [
        {
          name: 'home',
          status: 'changed' as const,
          head: { sha256: 'h', thumbnail: 't', width: 10, height: 20, metadata: {} },
          base: null,
        },
        { name: 'quiet', status: 'unchanged' as const, head: null, base: null },
      ],
    }
    expect(frameOf(detail, 'home', 'flaky')).toMatchObject({
      status: 'flaky',
      label: 'Flaky',
      src: '/api/files/t',
      sha256: 'h',
    })
    expect(frameOf(detail, 'home', 'no_baseline').status).toBe('needs-review')
    expect(frameOf(detail, 'quiet', 'flaky').status).toBe('neutral')
    expect(frameOf(detail, 'gone', 'flaky').label).toBe('Not in this build')
  })
})
