import type { Baseline, Snapshot } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  filterBaselines,
  flattenGroups,
  groupBaselines,
  historyLabel,
  namePrefix,
} from '#features/baselines/api.ts'

const item = (name: string, buildName = 'default', over: Partial<Baseline.Item> = {}) => ({
  name,
  buildName,
  width: 100,
  height: 50,
  sizeBytes: 2048,
  fileSha256: 'f',
  thumbnailSha256: null,
  buildNumber: 7,
  commitSha: 'abc1234',
  approvedAt: '2026-11-08T10:00:00.000Z',
  approvedBy: null,
  ...over,
})

describe('historyLabel', () => {
  const entry = (approvedBy: { id: string; name: string } | null): Snapshot.HistoryEntry => ({
    build: {
      number: 3,
      branch: 'main',
      status: 'complete',
      reviewStatus: 'approved',
      createdAt: '2026-11-08T10:00:00.000Z',
    },
    status: 'changed',
    approvedBy,
    image: null,
  })

  it('says by whom, or that it was approved automatically', () => {
    expect(historyLabel(entry({ id: 'u1', name: 'Maya Levi' }))).toBe(
      'Changed, approved by Maya Levi',
    )
    expect(historyLabel(entry(null))).toBe('Changed, approved automatically')
  })
})

describe('baselines', () => {
  it('groups by the name prefix before the first slash, ungrouped last, sorted by name', () => {
    const groups = groupBaselines([
      item('nav/header'),
      item('home'),
      item('checkout/summary'),
      item('checkout/a/b'),
      item('/odd'),
    ])
    expect(groups.map((g) => g.prefix)).toEqual(['checkout', 'nav', null])
    expect(flattenGroups(groups).map((i) => i.name)).toEqual([
      'checkout/a/b',
      'checkout/summary',
      'nav/header',
      '/odd',
      'home',
    ])
    expect(namePrefix('a/b/c')).toBe('a')
    expect(namePrefix('plain')).toBeNull()
  })

  it('filters by name, build name, commit or build number', () => {
    const list = [
      item('Home'),
      item('pricing', 'storybook', { commitSha: 'ffee001', buildNumber: 9 }),
    ]
    expect(filterBaselines(list, '').length).toBe(2)
    expect(filterBaselines(list, ' HOME ').map((i) => i.name)).toEqual(['Home'])
    expect(filterBaselines(list, 'story').map((i) => i.name)).toEqual(['pricing'])
    expect(filterBaselines(list, 'ffee').length).toBe(1)
    expect(filterBaselines(list, '#9').length).toBe(1)
    expect(filterBaselines(list, 'nope')).toEqual([])
  })
})
