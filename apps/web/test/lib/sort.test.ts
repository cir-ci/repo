import { describe, expect, it } from 'vitest'

import {
  ariaSort,
  cellValue,
  compareValues,
  formatSort,
  nextSort,
  parseSort,
  sortFromMap,
  sortRows,
  withTableSort,
} from '#lib/sort.ts'

describe('compareValues', () => {
  it('orders numbers by value, not as text', () => {
    expect(compareValues(2, 10)).toBeLessThan(0)
    expect(compareValues(10, 2)).toBeGreaterThan(0)
    expect(compareValues(3, 3)).toBe(0)
  })

  it('orders dates by time', () => {
    expect(compareValues(new Date('2026-01-01'), new Date('2026-02-01'))).toBeLessThan(0)
  })

  it('orders names by the locale: case and accents ignored, digits as numbers', () => {
    expect(compareValues('apple', 'Banana')).toBeLessThan(0)
    expect(compareValues('Émile', 'Zoe')).toBeLessThan(0)
    expect(compareValues('shot 2', 'shot 10')).toBeLessThan(0)
    expect(compareValues('a', 'A')).toBe(0)
  })

  it('puts a missing value after any value', () => {
    expect(compareValues(null, 5)).toBeGreaterThan(0)
    expect(compareValues('x', undefined)).toBeLessThan(0)
    expect(compareValues(Number.NaN, 0)).toBeGreaterThan(0)
    expect(compareValues(null, undefined)).toBe(0)
  })
})

describe('nextSort', () => {
  it('goes ascending, descending, then back to the default order', () => {
    const first = nextSort(null, 'name')
    expect(first).toEqual({ key: 'name', direction: 'asc' })
    const second = nextSort(first, 'name')
    expect(second).toEqual({ key: 'name', direction: 'desc' })
    expect(nextSort(second, 'name')).toBeNull()
  })

  it('starts ascending on another column', () => {
    expect(nextSort({ key: 'name', direction: 'desc' }, 'age')).toEqual({
      key: 'age',
      direction: 'asc',
    })
  })
})

describe('sortRows', () => {
  const rows = [
    { name: 'b', n: 2, hours: null as number | null },
    { name: 'a', n: 10, hours: 3 },
    { name: 'c', n: 1, hours: 1 },
    { name: 'd', n: 1, hours: null },
  ]
  const accessors = {
    name: (r: (typeof rows)[number]) => r.name,
    n: (r: (typeof rows)[number]) => r.n,
    hours: (r: (typeof rows)[number]) => r.hours,
  }
  const names = (sort: Parameters<typeof sortRows>[2]) =>
    sortRows(rows, accessors, sort)
      .map((r) => r.name)
      .join('')

  it('keeps the given order with no sort or an unknown column', () => {
    expect(names(null)).toBe('bacd')
    expect(names({ key: 'nope', direction: 'asc' })).toBe('bacd')
  })

  it('sorts ascending and descending, leaving equal rows in their order', () => {
    expect(names({ key: 'n', direction: 'asc' })).toBe('cdba')
    expect(names({ key: 'n', direction: 'desc' })).toBe('abcd')
    expect(names({ key: 'name', direction: 'desc' })).toBe('dcba')
  })

  it('puts missing values last in both directions', () => {
    expect(names({ key: 'hours', direction: 'asc' })).toBe('cabd')
    expect(names({ key: 'hours', direction: 'desc' })).toBe('acbd')
  })

  it('does not change the rows it is given', () => {
    const before = rows.map((r) => r.name).join('')
    names({ key: 'n', direction: 'asc' })
    expect(rows.map((r) => r.name).join('')).toBe(before)
  })
})

describe('the sort in text', () => {
  const keys = ['name', 'builds']
  it('round-trips, and drops a column that is not one of the table', () => {
    expect(formatSort({ key: 'builds', direction: 'desc' })).toBe('-builds')
    expect(parseSort('-builds', keys)).toEqual({ key: 'builds', direction: 'desc' })
    expect(parseSort('name', keys)).toEqual({ key: 'name', direction: 'asc' })
    expect(parseSort('other', keys)).toBeNull()
    expect(formatSort(null)).toBe('')
  })

  it('keeps several tables in one string and changes one at a time', () => {
    let text = withTableSort(undefined, 'projects', { key: 'builds', direction: 'desc' })
    text = withTableSort(text, 'reviewers', { key: 'name', direction: 'asc' })
    expect(text).toBe('projects:-builds,reviewers:name')
    expect(sortFromMap(text, 'projects', ['builds'])).toEqual({ key: 'builds', direction: 'desc' })
    expect(sortFromMap(text, 'reviewers', keys)).toEqual({ key: 'name', direction: 'asc' })
    expect(sortFromMap(text, 'storage', keys)).toBeNull()
    text = withTableSort(text, 'projects', null)
    expect(text).toBe('reviewers:name')
    expect(withTableSort(text, 'reviewers', null)).toBeUndefined()
  })

  it('names the aria-sort of each header', () => {
    const sort = { key: 'a', direction: 'desc' } as const
    expect(ariaSort(sort, 'a')).toBe('descending')
    expect(ariaSort(sort, 'b')).toBe('none')
    expect(ariaSort({ key: 'a', direction: 'asc' }, 'a')).toBe('ascending')
    expect(ariaSort(null, 'a')).toBe('none')
  })
})

describe('cellValue', () => {
  it('reads figures, durations and sizes from the text shown', () => {
    expect(cellValue('1,234')).toBe(1234)
    expect(cellValue('45%')).toBe(45)
    expect(cellValue('3.4h')).toBe(3.4)
    expect(cellValue('42m')).toBeCloseTo(0.7)
    expect(cellValue('2.1d')).toBeCloseTo(50.4)
    expect(cellValue('1.5 KB')).toBe(1536)
  })

  it('reads a dash as missing and anything else as text', () => {
    expect(cellValue('–')).toBeNull()
    expect(cellValue('Nov 3')).toBe('Nov 3')
  })
})
