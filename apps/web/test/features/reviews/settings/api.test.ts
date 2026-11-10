import type { ReviewRule, Triage } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  describeHours,
  draftOf,
  draftProblem,
  movedRuleIds,
  patternProblem,
  reviewerNames,
  rotationBody,
  rotationDirty,
  ruleBody,
  ruleDirty,
  startDateOf,
  startDateProblem,
  targetDirty,
  targetProblem,
  targetValue,
  toggleMember,
} from '#features/reviews/settings/api.ts'

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
    expect(targetProblem('720')).toBeNull()
    expect(targetProblem('721')).toBe('Enter a whole number of hours from 1 to 720')
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
    // A day that does not exist is not rolled over to the next month.
    expect(startDateProblem('2026-02-31')).toBe('Enter a real date')
    expect(startDateProblem('2026-04-31')).toBe('Enter a real date')
    expect(startDateProblem('2028-02-29')).toBeNull()
    expect(startDateProblem('2026-02-29')).toBe('Enter a real date')
    // The date input says its text is not a date: its value is empty, which is not "start now".
    expect(startDateProblem('', true)).toBe('Enter a real date')
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
