import type { ReviewRule, Triage } from '@circi/api'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  describeHours,
  draftOf,
  draftProblem,
  formatBytes,
  movedRuleIds,
  patternProblem,
  preferencesQuery,
  reviewerNames,
  rotationBody,
  rotationDirty,
  ruleBody,
  ruleDirty,
  startDateOf,
  startDateProblem,
  kindRows,
  teamRows,
  fileCount,
  dayCount,
  targetDirty,
  targetProblem,
  targetValue,
  toggleMember,
} from '#features/settings/api.ts'

afterEach(() => vi.unstubAllGlobals())

const rule: ReviewRule.Item = {
  id: 'r1',
  kind: 'snapshot-name',
  pattern: 'checkout/**',
  position: 0,
  reviewers: [
    { id: 'u1', name: 'Ada' },
    { id: 'u2', name: 'Grace' },
  ],
}

describe('rule validation', () => {
  it('accepts ordinary globs and rejects empty, long and triple-star ones', () => {
    expect(patternProblem('checkout/**')).toBeNull()
    expect(patternProblem('Button ?')).toBeNull()
    expect(patternProblem('   ')).toMatch(/Enter a pattern/)
    expect(patternProblem('a'.repeat(201))).toMatch(/at most 200/)
    expect(patternProblem('a***b')).toMatch(/three stars/)
  })

  it('needs a reviewer', () => {
    expect(draftProblem({ kind: 'build-name', pattern: 'x', reviewerIds: [] })).toMatch(/reviewer/)
    expect(draftProblem(draftOf(rule))).toBeNull()
  })
})

describe('rule payload and dirty detection', () => {
  it('trims the pattern', () => {
    expect(ruleBody({ kind: 'build-name', pattern: ' release/* ', reviewerIds: ['u1'] })).toEqual({
      kind: 'build-name',
      pattern: 'release/*',
      reviewerIds: ['u1'],
    })
  })

  it('is clean for the saved rule, whatever the reviewer order, and dirty after a change', () => {
    expect(ruleDirty(rule, draftOf(rule))).toBe(false)
    expect(ruleDirty(rule, { ...draftOf(rule), reviewerIds: ['u2', 'u1'] })).toBe(false)
    expect(ruleDirty(rule, { ...draftOf(rule), pattern: 'checkout/*' })).toBe(true)
    expect(ruleDirty(rule, { ...draftOf(rule), kind: 'build-name' })).toBe(true)
    expect(ruleDirty(rule, { ...draftOf(rule), reviewerIds: ['u1'] })).toBe(true)
  })

  it('names the reviewers briefly', () => {
    expect(reviewerNames({ reviewers: [] })).toBe('No reviewers')
    expect(reviewerNames(rule)).toBe('Ada and Grace')
    const many = { reviewers: ['A', 'B', 'C', 'D'].map((name) => ({ id: name, name })) }
    expect(reviewerNames(many)).toBe('A, B and 2 others')
  })
})

describe('review target', () => {
  it('wants a whole number of hours', () => {
    expect(targetProblem('24')).toBeNull()
    expect(targetProblem('0')).not.toBeNull()
    expect(targetProblem('1.5')).not.toBeNull()
    expect(targetProblem('')).not.toBeNull()
    expect(targetProblem('99999')).not.toBeNull()
  })

  it('saves null when off and detects changes', () => {
    expect(targetValue(false, '24')).toBeNull()
    expect(targetValue(true, ' 48 ')).toBe(48)
    expect(targetDirty(24, true, '24')).toBe(false)
    expect(targetDirty(24, true, '48')).toBe(true)
    expect(targetDirty(24, false, '24')).toBe(true)
    expect(targetDirty(null, false, '24')).toBe(false)
    expect(targetDirty(null, true, '24')).toBe(true)
  })

  it('says days when it can', () => {
    expect(describeHours(24)).toBe('1 day')
    expect(describeHours(48)).toBe('2 days')
    expect(describeHours(36)).toBe('36 hours')
    expect(describeHours(1)).toBe('1 hour')
  })
})

describe('triage rotation', () => {
  const saved: Triage.Rotation = {
    startsOn: '2026-11-02T00:00:00.000Z',
    members: [
      { id: 'u1', name: 'Ada' },
      { id: 'u2', name: 'Grace' },
    ],
  }

  it('builds the body: no date when empty or blank', () => {
    expect(rotationBody([], '2026-11-02')).toEqual({ memberIds: [] })
    expect(rotationBody(['u1'], '')).toEqual({ memberIds: ['u1'] })
    expect(rotationBody(['u1', 'u2'], '2026-11-02')).toEqual({
      memberIds: ['u1', 'u2'],
      startsOn: '2026-11-02T00:00:00.000Z',
    })
  })

  it('reads the date back and validates it', () => {
    expect(startDateOf(saved)).toBe('2026-11-02')
    expect(startDateOf({ startsOn: null, members: [] })).toBe('')
    expect(startDateProblem('')).toBeNull()
    expect(startDateProblem('2026-11-02')).toBeNull()
    expect(startDateProblem('2026-13-45')).not.toBeNull()
    expect(startDateProblem('soon')).not.toBeNull()
  })

  it('is dirty when members, their order or the date change', () => {
    expect(rotationDirty(saved, ['u1', 'u2'], '2026-11-02')).toBe(false)
    expect(rotationDirty(saved, ['u2', 'u1'], '2026-11-02')).toBe(true)
    expect(rotationDirty(saved, ['u1'], '2026-11-02')).toBe(true)
    expect(rotationDirty(saved, ['u1', 'u2'], '2026-11-09')).toBe(true)
    expect(rotationDirty({ startsOn: null, members: [] }, [], '')).toBe(false)
    expect(rotationDirty({ startsOn: null, members: [] }, ['u1'], '')).toBe(true)
  })

  it('toggles members, appending new ones', () => {
    expect(toggleMember(['u1'], 'u2', true)).toEqual(['u1', 'u2'])
    expect(toggleMember(['u1', 'u2'], 'u1', false)).toEqual(['u2'])
    expect(toggleMember(['u1'], 'u1', true)).toEqual(['u1'])
  })
})

const team = (slug: string, bytes: number) => ({
  slug,
  name: slug.toUpperCase(),
  color: 'slate' as const,
  icon: null,
  retentionDays: 90,
  files: 1,
  bytes,
})

describe('storage', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1500)).toBe('1.5 KB')
    expect(formatBytes(2_000_000)).toBe('2 MB')
    expect(formatBytes(230_000_000)).toBe('230 MB')
  })

  it('lists every kind in order, with its share of the total', () => {
    const rows = kindRows({
      totalBytes: 400,
      kinds: [
        { kind: 'diff', files: 2, bytes: 100 },
        { kind: 'screenshot', files: 5, bytes: 300 },
        { kind: 'site', files: 9, bytes: 50, versions: 3 },
      ],
    })
    expect(rows.map((r) => [r.kind, r.bytes, r.share])).toEqual([
      ['screenshot', 300, 0.75],
      ['diff', 100, 0.25],
      ['thumbnail', 0, 0],
      ['site', 50, 0.125],
    ])
    expect(rows[3]?.versions).toBe(3)
  })

  it('has no share when nothing is stored', () => {
    expect(kindRows({ totalBytes: 0, kinds: [] }).every((r) => r.share === 0)).toBe(true)
  })

  it('sorts teams by size, the biggest with a full bar', () => {
    const rows = teamRows({ teams: [team('a', 100), team('b', 400), team('c', 0)] })
    expect(rows.map((r) => [r.slug, r.share])).toEqual([
      ['b', 1],
      ['a', 0.25],
      ['c', 0],
    ])
    expect(teamRows({ teams: [team('a', 0)] })[0]?.share).toBe(0)
  })

  it('counts files and days', () => {
    expect(fileCount(1)).toBe('1 file')
    expect(fileCount(41260)).toBe('41,260 files')
    expect(dayCount(1)).toBe('1 day')
    expect(dayCount(90)).toBe('90 days')
  })
})

describe('preferences query', () => {
  it('reads the preferences', async () => {
    vi.stubGlobal('fetch', async (path: string) => {
      expect(path).toBe('/api/inbox/preferences')
      return Response.json({ emailReviewRequested: true, emailReviewOverdue: false })
    })
    const data = await new QueryClient().fetchQuery(preferencesQuery())
    expect(data.emailReviewOverdue).toBe(false)
  })
})

describe('movedRuleIds', () => {
  const rules = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('moves a rule one place and stops at the ends', () => {
    expect(movedRuleIds(rules, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(movedRuleIds(rules, 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(movedRuleIds(rules, 'a', -1)).toBeNull()
    expect(movedRuleIds(rules, 'c', 1)).toBeNull()
    expect(movedRuleIds(rules, 'zzz', 1)).toBeNull()
  })
})
