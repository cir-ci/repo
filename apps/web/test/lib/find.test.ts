import { describe, expect, it } from 'vitest'

import { parseFilters, toQuery } from '#features/builds/list/builds-filters.ts'
import { findIn, findParam, matchesFind } from '#lib/find.ts'

describe('matchesFind', () => {
  it('needs every word, in any case, anywhere in the fields', () => {
    expect(matchesFind('checkout', ['Checkout / summary'])).toBe(true)
    expect(matchesFind('SUMMARY checkout', ['Checkout / summary'])).toBe(true)
    expect(matchesFind('checkout cart', ['Checkout / summary'])).toBe(false)
    expect(matchesFind('main', [null, undefined, 'feature/main-nav'])).toBe(true)
  })

  it('matches everything for a blank query', () => {
    expect(matchesFind('  ', [])).toBe(true)
  })
})

describe('findIn', () => {
  it('keeps the items whose fields match, and all of them for a blank query', () => {
    const items = [{ n: 'home' }, { n: 'checkout/summary' }]
    expect(findIn(items, 'sum', (i) => [i.n])).toEqual([{ n: 'checkout/summary' }])
    expect(findIn(items, ' ', (i) => [i.n])).toEqual(items)
  })
})

describe('findParam', () => {
  it('reads text, and a number the address parsed from "148"', () => {
    expect(findParam('web')).toBe('web')
    expect(findParam(148)).toBe('148')
    expect(findParam(undefined)).toBe('')
    expect(findParam({})).toBe('')
  })
})

describe('the free-text builds filter', () => {
  it('is kept from the address as text and sent as `q`', () => {
    expect(parseFilters({ q: 148 })).toEqual({ q: '148' })
    expect(parseFilters({ q: '  ' })).toEqual({})
    expect(toQuery({ q: 'octo cat' })).toBe('?q=octo+cat')
  })
})
