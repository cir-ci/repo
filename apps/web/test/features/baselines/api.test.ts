import type { Baseline } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  countLabel,
  dimensionsLabel,
  filterBaselines,
  flattenGroups,
  groupBaselines,
  sizeLabel,
} from '../../../src/features/baselines/api.ts'

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
  ...over,
})

describe('baselines', () => {
  it('groups by build name, default first, sorted by name', () => {
    const groups = groupBaselines([
      item('b', 'storybook'),
      item('z'),
      item('a', 'storybook'),
      item('c'),
    ])
    expect(groups.map((g) => g.buildName)).toEqual(['default', 'storybook'])
    expect(flattenGroups(groups).map((i) => i.name)).toEqual(['c', 'z', 'a', 'b'])
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

  it('labels sizes and counts', () => {
    expect(sizeLabel(null)).toBe('')
    expect(sizeLabel(100)).toBe('1 kB')
    expect(sizeLabel(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(dimensionsLabel({ width: 1280, height: 720 })).toBe('1280 × 720')
    expect(dimensionsLabel({ width: null, height: null })).toBe('')
    expect(countLabel(3, 3)).toBe('3 baselines')
    expect(countLabel(1, 1)).toBe('1 baseline')
    expect(countLabel(1, 3)).toBe('1 of 3 baselines')
  })
})
