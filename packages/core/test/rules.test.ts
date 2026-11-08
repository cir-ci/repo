import { describe, expect, it } from 'vitest'

import { globMatches, reviewersForBuild } from '../src/rules.ts'

describe('globMatches', () => {
  it('matches the whole name, case-sensitively', () => {
    expect(globMatches('home', 'home')).toBe(true)
    expect(globMatches('home', 'homepage')).toBe(false)
    expect(globMatches('home', 'Home')).toBe(false)
    expect(globMatches('', '')).toBe(true)
    expect(globMatches('', 'a')).toBe(false)
  })

  it('lets * stand for any run except a slash', () => {
    expect(globMatches('checkout/*', 'checkout/pay')).toBe(true)
    expect(globMatches('checkout/*', 'checkout/')).toBe(true)
    expect(globMatches('checkout/*', 'checkout/pay/card')).toBe(false)
    expect(globMatches('*', 'a/b')).toBe(false)
    expect(globMatches('*-mobile', 'home-mobile')).toBe(true)
  })

  it('lets ** cross slashes, and a/**/b also match a/b', () => {
    expect(globMatches('**', 'a/b/c')).toBe(true)
    expect(globMatches('checkout/**', 'checkout/pay/card')).toBe(true)
    expect(globMatches('a/**/b', 'a/b')).toBe(true)
    expect(globMatches('a/**/b', 'a/x/y/b')).toBe(true)
    expect(globMatches('a/**/b', 'a/x/c')).toBe(false)
  })

  it('lets ? stand for one character that is not a slash', () => {
    expect(globMatches('v?', 'v1')).toBe(true)
    expect(globMatches('v?', 'v10')).toBe(false)
    expect(globMatches('v?', 'v')).toBe(false)
    expect(globMatches('a?b', 'a/b')).toBe(false)
  })

  it('takes every other character literally', () => {
    expect(globMatches('a.b', 'axb')).toBe(false)
    expect(globMatches('a.b', 'a.b')).toBe(true)
    expect(globMatches('(x)[y]{z}|+^$', '(x)[y]{z}|+^$')).toBe(true)
    expect(globMatches('a\\b', 'a\\b')).toBe(true)
  })
})

describe('reviewersForBuild', () => {
  const rules = [
    { kind: 'snapshot-name', pattern: 'checkout/**', reviewers: ['ann', 'bob'] },
    { kind: 'build-name', pattern: 'mobile-*', reviewers: ['bob', 'cy'] },
    { kind: 'snapshot-name', pattern: 'admin/*', reviewers: ['dee'] },
  ] as const

  it('asks the reviewers of every matching rule once, in rule order', () => {
    expect(
      reviewersForBuild(rules, { name: 'mobile-ios', snapshotNames: ['checkout/pay', 'home'] }),
    ).toEqual(['ann', 'bob', 'cy'])
  })

  it('matches a snapshot rule on any snapshot, and a build rule on the build name only', () => {
    expect(reviewersForBuild(rules, { name: 'default', snapshotNames: ['admin/users'] })).toEqual([
      'dee',
    ])
    expect(reviewersForBuild(rules, { name: 'default', snapshotNames: ['mobile-ios'] })).toEqual([])
  })

  it('gives nobody when no rule matches', () => {
    expect(reviewersForBuild(rules, { name: 'default', snapshotNames: [] })).toEqual([])
    expect(reviewersForBuild([], { name: 'x', snapshotNames: ['y'] })).toEqual([])
  })
})
