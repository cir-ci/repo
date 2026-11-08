import { describe, expect, it } from 'vitest'

import {
  describeAgent,
  nameDirty,
  passwordProblems,
  providerName,
  providerRows,
} from '#features/account/model.ts'

describe('describeAgent', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14) Gecko/20100101 Firefox/130.0', 'Firefox on macOS'],
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36', 'Chrome on Windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604.1', 'Safari on iOS'],
    ['curl/8.1', 'curl'],
  ])('names %j', (agent, name) => {
    expect(describeAgent(agent)).toBe(name)
  })
  it('copes with nothing', () => {
    expect(describeAgent(null)).toBe('Unknown device')
  })
})

const account = (providerId: string) => ({
  id: providerId,
  providerId,
  accountId: '1',
  updatedAt: '2026-01-01T00:00:00Z',
})

describe('providerRows', () => {
  const offered = [
    { id: 'github', name: 'GitHub' },
    { id: 'google', name: 'Google' },
  ]
  it('lists linked providers first, then the offered ones not linked, never the password', () => {
    const rows = providerRows([account('credential'), account('google')], offered)
    expect(rows.map((r) => [r.id, r.name, r.account !== undefined])).toEqual([
      ['google', 'Google', true],
      ['github', 'GitHub', false],
    ])
  })
  it('names a linked provider the instance no longer offers', () => {
    expect(providerRows([account('gitlab')], [])[0]?.name).toBe('GitLab')
    expect(providerName('custom-sso')).toBe('custom-sso')
  })
  it('is empty when there is nothing to link', () => {
    expect(providerRows([account('credential')], [])).toEqual([])
  })
})

describe('passwordProblems', () => {
  const ok = { current: 'old-password-1', next: 'a-much-longer-one', confirm: 'a-much-longer-one' }
  it('accepts a long enough, confirmed, different password', () => {
    expect(passwordProblems(ok)).toEqual({})
  })
  it('names each problem', () => {
    expect(passwordProblems({ current: '', next: 'short', confirm: 'other' })).toEqual({
      current: 'Enter your current password',
      next: 'Use at least 12 characters',
      confirm: 'The two passwords don’t match',
    })
  })
  it('refuses the same password again', () => {
    const same = 'exactly-the-same-1'
    expect(passwordProblems({ current: same, next: same, confirm: same }).next).toMatch(
      /different password/,
    )
  })
})

describe('nameDirty', () => {
  it('is dirty for a real change only', () => {
    expect(nameDirty('Ada', 'Ada')).toBe(false)
    expect(nameDirty('Ada', ' Ada ')).toBe(false)
    expect(nameDirty('Ada', '  ')).toBe(false)
    expect(nameDirty('Ada', 'Ada King')).toBe(true)
  })
})
