import type { ReviewRule, Triage } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
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
  flakyProblem,
  formProblems,
  formValuesOf,
  overdueExample,
  settingsPatch,
  targetProblem,
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

  it('gives the board example, counting working days', () => {
    expect(overdueExample('24')).toBe(
      'Example: a request made Friday 16:00 becomes overdue Monday 16:00.',
    )
    expect(overdueExample('8')).toBe(
      'Example: a request made Friday 16:00 becomes overdue Monday 00:00.',
    )
    expect(overdueExample('')).toBeNull()
    expect(overdueExample('0')).toBeNull()
  })
})

describe('the form values', () => {
  const settings = {
    reviewTargetHours: 24 as number | null,
    reviewOverdueNotifyUserId: null as string | null,
    closeReviewsOnNewerBuild: true,
    reRequestOnNewerBuild: false,
    autoApproveNoChanges: true,
    requireRejectReason: false,
    flakyAfterChanges: 3,
    snoozeDefaultDays: 7,
  }
  const rotation: Triage.Rotation = {
    startsOn: '2026-11-02T00:00:00.000Z',
    members: [{ id: 'u1', name: 'Ada' }],
  }

  it('start as the saved settings, with nothing to send', () => {
    const values = formValuesOf(settings, rotation)
    expect(values).toMatchObject({
      hours: '24',
      notifyUserId: '',
      flakyAfter: '3',
      snoozeDays: '7',
    })
    expect(settingsPatch(settings, values)).toEqual({})
  })

  it('send only what changed, null for an emptied target or nobody to tell', () => {
    const saved = { ...settings, reviewOverdueNotifyUserId: 'u1' }
    const values = formValuesOf(saved, rotation)
    expect(
      settingsPatch(saved, {
        ...values,
        hours: '',
        notifyUserId: '',
        close: false,
        requireReason: true,
        flakyAfter: '5',
        snoozeDays: '14',
      }),
    ).toEqual({
      reviewTargetHours: null,
      reviewOverdueNotifyUserId: null,
      closeReviewsOnNewerBuild: false,
      requireRejectReason: true,
      flakyAfterChanges: 5,
      snoozeDefaultDays: 14,
    })
  })

  it('wants a whole number of returns from 2 to 8 (what the 10-build window allows), and allows no target', () => {
    expect(flakyProblem('3')).toBeNull()
    expect(flakyProblem('2')).toBeNull()
    expect(flakyProblem('8')).toBeNull()
    expect(flakyProblem('1')).toBe('Enter a whole number from 2 to 8')
    expect(flakyProblem('9')).toBe('Enter a whole number from 2 to 8')
    expect(flakyProblem('')).not.toBeNull()
    const values = formValuesOf(settings, rotation)
    expect(formProblems({ ...values, hours: '' })).toEqual({})
    expect(formProblems({ ...values, hours: '0', flakyAfter: '' })).toEqual({
      hours: 'Enter a whole number of hours from 1 to 720',
      flakyAfter: 'Enter a whole number from 2 to 8',
    })
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
    expect(startDateProblem('2026-02-31')).toBe('Enter a valid date')
    expect(startDateProblem('2026-04-31')).toBe('Enter a valid date')
    expect(startDateProblem('2028-02-29')).toBeNull()
    expect(startDateProblem('2026-02-29')).toBe('Enter a valid date')
    // The date input says its text is not a date: its value is empty, which is not "start now".
    expect(startDateProblem('', true)).toBe('Enter a valid date')
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
