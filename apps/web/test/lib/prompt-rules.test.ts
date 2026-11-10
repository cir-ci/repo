import { describe, expect, it } from 'vitest'

import {
  EMPTY_PROMPTS,
  isApprovalRequest,
  isPutOff,
  MAX_NOT_NOW,
  NO_DISMISSALS,
  NOT_NOW_DAYS,
  parseStoredPrompts,
  putOff,
  shouldAskForPush,
  shouldOfferInstall,
} from '#lib/prompt-rules.ts'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 10)

describe('"Not now"', () => {
  it('hides the offer for 14 days, then it returns', () => {
    const once = putOff(NO_DISMISSALS, NOW)
    expect(once).toEqual({ count: 1, lastAt: NOW })
    expect(isPutOff(NO_DISMISSALS, NOW)).toBe(false)
    expect(isPutOff(once, NOW + 1000)).toBe(true)
    expect(isPutOff(once, NOW + (NOT_NOW_DAYS - 1) * DAY)).toBe(true)
    expect(isPutOff(once, NOW + NOT_NOW_DAYS * DAY)).toBe(false)
  })

  it('stays hidden after the third "Not now"', () => {
    let d = NO_DISMISSALS
    for (let i = 0; i < MAX_NOT_NOW; i += 1) d = putOff(d, NOW + i * 30 * DAY)
    expect(d.count).toBe(3)
    expect(isPutOff(d, NOW + 400 * DAY)).toBe(true)
  })
})

describe('shouldOfferInstall', () => {
  const base = {
    visits: 2,
    approved: false,
    installed: false,
    canInstall: true,
    dismissals: NO_DISMISSALS,
    now: NOW,
  }

  it('is never shown on the first visit, unless something was approved', () => {
    expect(shouldOfferInstall({ ...base, visits: 1 })).toBe(false)
    expect(shouldOfferInstall({ ...base, visits: 2 })).toBe(true)
    expect(shouldOfferInstall({ ...base, visits: 1, approved: true })).toBe(true)
  })

  it('needs a browser that can install, and an app not yet installed', () => {
    expect(shouldOfferInstall({ ...base, canInstall: false })).toBe(false)
    expect(shouldOfferInstall({ ...base, installed: true })).toBe(false)
  })

  it('respects "Not now"', () => {
    const away = putOff(NO_DISMISSALS, NOW - DAY)
    expect(shouldOfferInstall({ ...base, dismissals: away })).toBe(false)
    expect(shouldOfferInstall({ ...base, dismissals: away, now: NOW + 14 * DAY })).toBe(true)
  })
})

describe('shouldAskForPush', () => {
  const base = {
    permission: 'default' as const,
    subscribed: false,
    triggered: true,
    needsInstall: false,
    dismissals: NO_DISMISSALS,
    now: NOW,
  }

  it('asks in context: only once a review landed or something was approved', () => {
    expect(shouldAskForPush(base)).toBe(true)
    expect(shouldAskForPush({ ...base, triggered: false })).toBe(false)
  })

  it('does not ask where the browser will not (granted, blocked, no push) or when already on', () => {
    for (const permission of ['granted', 'denied', 'unsupported'] as const) {
      expect(shouldAskForPush({ ...base, permission })).toBe(false)
    }
    expect(shouldAskForPush({ ...base, subscribed: true })).toBe(false)
  })

  it('leaves an iPhone that is not on the Home Screen to the install offer', () => {
    expect(shouldAskForPush({ ...base, needsInstall: true })).toBe(false)
  })

  it('returns after 14 days, at most 3 times', () => {
    const once = putOff(NO_DISMISSALS, NOW)
    expect(shouldAskForPush({ ...base, dismissals: once })).toBe(false)
    expect(shouldAskForPush({ ...base, dismissals: once, now: NOW + 15 * DAY })).toBe(true)
    const thrice = { count: 3, lastAt: NOW }
    expect(shouldAskForPush({ ...base, dismissals: thrice, now: NOW + 365 * DAY })).toBe(false)
  })
})

describe('parseStoredPrompts', () => {
  it('reads what was stored', () => {
    const stored = {
      visits: 3,
      approved: true,
      install: { count: 1, lastAt: NOW },
      push: { count: 2, lastAt: NOW },
    }
    expect(parseStoredPrompts(JSON.stringify(stored))).toEqual(stored)
  })

  it('treats anything missing or malformed as nothing having happened', () => {
    for (const raw of [null, '', 'nope', '[]', '"x"', '{"visits":-4,"install":5}']) {
      expect(parseStoredPrompts(raw)).toEqual(EMPTY_PROMPTS)
    }
  })
})

const body = (v: object) => JSON.stringify(v)

describe('isApprovalRequest', () => {
  it('recognises approving a build or screenshots', () => {
    expect(
      isApprovalRequest('POST', '/api/teams/a/b/builds/3/review', body({ state: 'approved' })),
    ).toBe(true)
    expect(
      isApprovalRequest(
        'POST',
        '/api/teams/a/b/builds/3/snapshots/review',
        body({ decision: 'approved', snapshotNames: ['x'] }),
      ),
    ).toBe(true)
    expect(
      isApprovalRequest('POST', '/api/teams/a/b/builds/3/review', body({ state: 'rejected' })),
    ).toBe(false)
    expect(isApprovalRequest('GET', '/api/teams/a/b/builds/3/review', undefined)).toBe(false)
    expect(isApprovalRequest('POST', '/api/inbox/x/read', body({ read: true }))).toBe(false)
  })
})
