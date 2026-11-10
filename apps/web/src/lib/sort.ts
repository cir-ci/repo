/**
 * Sorting a table by a column: the pure parts. A table declares its columns as accessors (row to
 * a `SortValue`) and keeps a `Sort | null`; `null` is the table's own order. A header press moves
 * to `nextSort`: ascending, descending, then back to `null`. Missing values (null, undefined, NaN)
 * sort last in both directions, and rows that compare equal keep their order.
 */

export type SortValue = number | string | Date | null | undefined
export type SortDirection = 'asc' | 'desc'

export interface Sort {
  key: string
  direction: SortDirection
}

export type Accessors<T> = Readonly<Record<string, (row: T) => SortValue>>

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function present(value: SortValue): number | string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isNaN(time) ? null : time
  }
  if (typeof value === 'number') return Number.isNaN(value) ? null : value
  return value
}

/**
 * Ascending order of two values: numbers and dates by value, text by the locale's rules (case
 * and accents ignored, "2" before "10"), a number before text, and a missing value after all.
 */
export function compareValues(a: SortValue, b: SortValue): number {
  const x = present(a)
  const y = present(b)
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
  if (typeof x === 'number' && typeof y === 'number') return x === y ? 0 : x < y ? -1 : 1
  if (typeof x === 'number') return -1
  if (typeof y === 'number') return 1
  return collator.compare(x, y)
}

/** The sort a press on `key`'s header leads to: ascending, descending, then none. */
export function nextSort(current: Sort | null, key: string): Sort | null {
  if (current === null || current.key !== key) return { key, direction: 'asc' }
  return current.direction === 'asc' ? { key, direction: 'desc' } : null
}

/** The rows in the sorted order (a new array); with no sort, or an unknown column, as they are. */
export function sortRows<T>(rows: readonly T[], accessors: Accessors<T>, sort: Sort | null): T[] {
  const get = sort ? accessors[sort.key] : undefined
  if (!sort || !get) return [...rows]
  const sign = sort.direction === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, value: get(row) }))
    .toSorted((a, b) => {
      // Missing values go last whichever way the column is sorted.
      const missing = (present(a.value) === null ? 1 : 0) - (present(b.value) === null ? 1 : 0)
      if (missing !== 0) return missing
      return sign * compareValues(a.value, b.value) || a.index - b.index
    })
    .map((entry) => entry.row)
}

/** The `aria-sort` of `key`'s header. */
export function ariaSort(sort: Sort | null, key: string): 'none' | 'ascending' | 'descending' {
  if (!sort || sort.key !== key) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}

/** `key` for ascending, `-key` for descending: how a sort sits in a URL. */
export function formatSort(sort: Sort | null): string {
  return sort ? `${sort.direction === 'desc' ? '-' : ''}${sort.key}` : ''
}

/** The sort `formatSort` wrote, if its column is one of `keys`; otherwise none. */
export function parseSort(text: string, keys: readonly string[]): Sort | null {
  const direction: SortDirection = text.startsWith('-') ? 'desc' : 'asc'
  const key = direction === 'desc' ? text.slice(1) : text
  return keys.includes(key) ? { key, direction } : null
}

/** Several tables' sorts in one string: `teams:-builds,reviewers:reviews`. */
export function formatSortMap(map: Readonly<Record<string, Sort | null>>): string | undefined {
  const parts = Object.entries(map)
    .filter(([, sort]) => sort !== null)
    .map(([table, sort]) => `${table}:${formatSort(sort)}`)
  return parts.length > 0 ? parts.join(',') : undefined
}

/** The sort of `table` in a string `formatSortMap` wrote. */
export function sortFromMap(text: string | undefined, table: string, keys: readonly string[]) {
  for (const part of (text ?? '').split(',')) {
    const colon = part.indexOf(':')
    if (colon > 0 && part.slice(0, colon) === table) {
      return parseSort(part.slice(colon + 1), keys)
    }
  }
  return null
}

/** `text` with the sort of `table` set to `sort` (or removed); the other tables' sorts stay. */
export function withTableSort(
  text: string | undefined,
  table: string,
  sort: Sort | null,
): string | undefined {
  const kept = (text ?? '').split(',').filter((part) => part && !part.startsWith(`${table}:`))
  if (sort) kept.push(`${table}:${formatSort(sort)}`)
  return kept.length > 0 ? kept.join(',') : undefined
}

const UNIT_HOURS: Record<string, number> = { m: 1 / 60, h: 1, d: 24 }
const UNIT_BYTES: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
}

/**
 * A figure shown as text ("1,234", "45%", "3.4h", "42m", "2.1d", "1.5 KB") as a number, durations
 * in hours and sizes in bytes; a dash is a missing value; anything else stays text.
 */
export function cellValue(text: string): number | string | null {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === '–' || trimmed === '-') return null
  const match = /^(-?\d[\d,]*(?:\.\d+)?|-?\.\d+)\s*(%|[mhd]|[KMGT]?B)?$/.exec(trimmed)
  if (!match) return trimmed
  const amount = Number((match[1] ?? '').replaceAll(',', ''))
  const unit = match[2]
  if (unit === undefined || unit === '%') return amount
  return amount * (UNIT_HOURS[unit] ?? UNIT_BYTES[unit] ?? 1)
}
