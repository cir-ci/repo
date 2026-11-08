import type { Build } from '@circi/api'
import { describe, expect, it } from 'vitest'

import { DEFAULT_DISPLAY, groupBuilds, parseDisplay } from '#features/teams/display-options.ts'

const item = (number: number, branch: string | null = 'main'): Build.ListItem => ({
  id: `b${number}`,
  number,
  name: 'default',
  commitSha: 'abcdef1234567',
  branch,
  prNumber: null,
  status: 'complete',
  conclusion: 'changes_detected',
  reviewStatus: 'pending',
  createdAt: '2026-11-08T10:00:00.000Z',
  counts: { added: 0, removed: 0, changed: 1, unchanged: 0, failed: 0, total: 1 },
  author: null,
})

describe('display options', () => {
  it('falls back to the defaults for missing or broken storage', () => {
    expect(parseDisplay(null)).toEqual(DEFAULT_DISPLAY)
    expect(parseDisplay('{nope')).toEqual(DEFAULT_DISPLAY)
    expect(parseDisplay('{"groupBy":"zodiac","order":3,"show":{"author":"yes"}}')).toEqual(
      DEFAULT_DISPLAY,
    )
  })

  it('keeps valid parts and defaults the rest', () => {
    const options = parseDisplay('{"groupBy":"branch","show":{"counts":false}}')
    expect(options.groupBy).toBe('branch')
    expect(options.order).toBe('newest')
    expect(options.show).toEqual({ ...DEFAULT_DISPLAY.show, counts: false })
  })

  it('groups in order of first appearance', () => {
    const builds = [item(4, 'main'), item(3, 'dev'), item(2, 'main')]
    const groups = groupBuilds(builds, 'branch')
    expect(groups.map((g) => [g.label, g.builds.length])).toEqual([
      ['main', 2],
      ['dev', 1],
    ])
    expect(groupBuilds(builds, 'none')).toHaveLength(1)
    expect(groupBuilds(builds, 'author')[0]?.label).toBe('Unknown author')
  })
})
