import { describe, expect, it } from 'vitest'

import {
  activeState,
  chipName,
  dayEnd,
  dayStart,
  hasFilters,
  parseBuildsSearch,
  parseFilters,
  toQuery,
  toWorkspaceQuery,
  toSearch,
  withDates,
  withState,
  withText,
  without,
} from '#features/builds/list/builds-filters.ts'

describe('builds filters and the URL', () => {
  it('round-trips filters through the search object and the query string', () => {
    const filters = {
      status: 'complete',
      review: 'pending',
      branch: 'feature/x',
      author: 'ada',
      reviewer: 'grace',
      name: 'mobile',
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-08T23:59:59.999Z',
    } as const
    expect(parseBuildsSearch({ ...toSearch(filters, 40) })).toEqual({ ...filters, before: 40 })
    const query = new URLSearchParams(toQuery(filters, 40))
    expect(parseBuildsSearch(Object.fromEntries(query))).toEqual({ ...filters, before: 40 })
  })

  it('adds the order to the request, except the default newest first', () => {
    expect(toQuery({}, undefined, 'newest')).toBe('')
    expect(toQuery({}, undefined, 'oldest')).toBe('?order=oldest')
    expect(toQuery({ branch: 'main' }, 40, 'most-changes')).toBe(
      '?branch=main&before=40&order=most-changes',
    )
    expect(toWorkspaceQuery({}, 'abc', 'status')).toBe('?order=status&before=abc')
  })

  it('drops unknown keys and invalid values', () => {
    expect(
      parseBuildsSearch({
        status: 'exploded',
        review: 'maybe',
        branch: '  ',
        author: 7,
        from: 'yesterday',
        to: '',
        sort: 'asc',
        before: '1',
      }),
    ).toEqual({ author: '7' })
  })

  it('normalizes dates to UTC and keeps numeric names as text', () => {
    expect(parseFilters({ from: '2026-11-01T02:00:00+02:00', name: 2024 })).toEqual({
      from: '2026-11-01T00:00:00.000Z',
      name: '2024',
    })
  })

  it('is empty (a bare address) when nothing is set', () => {
    expect(toSearch({})).toEqual({})
    expect(toQuery({})).toBe('')
    expect(hasFilters({})).toBe(false)
    expect(hasFilters({ branch: 'main' })).toBe(true)
  })

  it('escapes values in the query', () => {
    expect(toQuery({ branch: 'a&b c' })).toBe('?branch=a%26b+c')
  })
})

describe('chips', () => {
  it('names a chip by its field and value', () => {
    expect(chipName('status', {})).toBe('Status')
    expect(chipName('status', { review: 'pending' })).toBe('Status: Needs review')
    expect(chipName('branch', { branch: 'main' })).toBe('Branch: main')
    expect(chipName('date', { from: '2026-11-01T00:00:00.000Z' })).toBe('Date: from 2026-11-01')
    const names = new Map([['u1', 'Ada Lovelace']])
    expect(chipName('author', { author: 'u1' }, names)).toBe('Author: Ada Lovelace')
    expect(chipName('reviewer', { reviewer: 'u9' }, names)).toBe('Reviewer: u9')
    expect(chipName('author', { author: 'octocat' }, names)).toBe('Author: octocat')
  })

  it('sets and clears the status choice, replacing both keys', () => {
    const set = withState({ status: 'error', branch: 'main' }, 'review')
    expect(set).toEqual({ branch: 'main', review: 'pending' })
    expect(activeState(set)?.label).toBe('Needs review')
    expect(withState(set, undefined)).toEqual({ branch: 'main' })
  })

  it('sets text and date filters, and clears one field', () => {
    expect(withText({}, 'branch', '  main ')).toEqual({ branch: 'main' })
    expect(withText({ branch: 'main' }, 'branch', '')).toEqual({})
    const dated = withDates({}, '2026-11-01', '2026-11-08')
    expect(dated).toEqual({ from: dayStart('2026-11-01'), to: dayEnd('2026-11-08') })
    expect(dayEnd('2026-11-08')).toBe('2026-11-08T23:59:59.999Z')
    expect(dayStart('nope')).toBeUndefined()
    expect(without({ ...dated, branch: 'x' }, 'date')).toEqual({ branch: 'x' })
  })
})

describe('toWorkspaceQuery', () => {
  it('is the filters plus the build id cursor', () => {
    expect(toWorkspaceQuery({})).toBe('')
    expect(toWorkspaceQuery({ review: 'pending' }, 'b1')).toBe('?review=pending&before=b1')
    expect(toWorkspaceQuery({}, 'b1')).toBe('?before=b1')
  })
})
