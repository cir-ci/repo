import type { View } from '@circi/api'

/** The filters of a builds list: the same keys as the API's query and a saved view's JSON. */
export type BuildFilters = View.Filters

/** What the team route keeps in its URL: the filters and the page cursor. */
export type BuildsSearch = BuildFilters & { before?: number }

const STATUSES = ['pending', 'uploading', 'processing', 'complete', 'error', 'expired'] as const
const REVIEWS = ['pending', 'approved', 'rejected'] as const
const TEXT_KEYS = ['branch', 'author', 'reviewer', 'name'] as const

/** An ISO datetime in the one form the API accepts (UTC, with the `Z`), or nothing. */
function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  const time = Date.parse(value)
  return Number.isNaN(time) ? undefined : new Date(time).toISOString()
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return values.find((v) => v === value)
}

/**
 * Filters from untrusted input (a URL's search params, a saved view's JSON): known keys with
 * valid values are kept, everything else is dropped.
 */
export function parseFilters(input: Record<string, unknown>): BuildFilters {
  const filters: BuildFilters = {}
  const status = oneOf(STATUSES, input['status'])
  if (status) filters.status = status
  const review = oneOf(REVIEWS, input['review'])
  if (review) filters.review = review
  for (const key of TEXT_KEYS) {
    // A URL parses `?name=2024` to a number; the filter is still the text.
    const raw = input[key]
    const value = typeof raw === 'number' ? String(raw) : raw
    if (typeof value === 'string' && value.trim() !== '') filters[key] = value.trim()
  }
  const from = isoOrUndefined(input['from'])
  if (from) filters.from = from
  const to = isoOrUndefined(input['to'])
  if (to) filters.to = to
  return filters
}

/** The route's `validateSearch`: the filters plus the `before` cursor (an integer above 1). */
export function parseBuildsSearch(search: Record<string, unknown>): BuildsSearch {
  const before = Number(search['before'])
  return {
    ...parseFilters(search),
    ...(Number.isInteger(before) && before > 1 ? { before } : {}),
  }
}

/** The search object for the URL: only what is set, so a bare team address stays bare. */
export function toSearch(filters: BuildFilters, before?: number): BuildsSearch {
  return { ...parseFilters({ ...filters }), ...(before ? { before } : {}) }
}

/** The query string of the builds request (with its leading `?`, or empty). */
export function toQuery(filters: BuildFilters, before?: number): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(toSearch(filters, before)))
    params.set(key, String(value))
  const text = params.toString()
  return text ? `?${text}` : ''
}

export const hasFilters = (filters: BuildFilters) =>
  Object.keys(parseFilters({ ...filters })).length > 0

export type FilterField = 'status' | 'branch' | 'author' | 'reviewer' | 'name' | 'date'

export const FILTER_FIELDS: readonly { field: FilterField; label: string }[] = [
  { field: 'status', label: 'Status' },
  { field: 'branch', label: 'Branch' },
  { field: 'author', label: 'Author' },
  { field: 'reviewer', label: 'Reviewer' },
  { field: 'name', label: 'Build name' },
  { field: 'date', label: 'Date' },
]

/** The Status chip's choices: each sets the build status, the review, or one of them. */
export const STATE_OPTIONS: readonly {
  id: string
  label: string
  patch: Pick<BuildFilters, 'status' | 'review'>
}[] = [
  { id: 'review', label: 'Needs review', patch: { review: 'pending' } },
  { id: 'approved', label: 'Approved', patch: { review: 'approved' } },
  { id: 'rejected', label: 'Rejected', patch: { review: 'rejected' } },
  { id: 'processing', label: 'Processing', patch: { status: 'processing' } },
  { id: 'failed', label: 'Failed', patch: { status: 'error' } },
  { id: 'expired', label: 'Expired', patch: { status: 'expired' } },
]

/** The Status choice a set of filters amounts to, if it is exactly one of them. */
export function activeState(filters: BuildFilters): (typeof STATE_OPTIONS)[number] | undefined {
  return STATE_OPTIONS.find(
    (o) => o.patch.status === filters.status && o.patch.review === filters.review,
  )
}

/** `filters` with the Status chip set to `id` (or cleared with undefined). */
export function withState(filters: BuildFilters, id: string | undefined): BuildFilters {
  const { status: _s, review: _r, ...rest } = filters
  const option = STATE_OPTIONS.find((o) => o.id === id)
  return { ...rest, ...option?.patch }
}

const DAY = 24 * 3600_000

/** A date input's value (`2026-11-08`) as the start of that UTC day, or nothing. */
export function dayStart(day: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? isoOrUndefined(`${day}T00:00:00.000Z`) : undefined
}

/** A date input's value as the last millisecond of that UTC day, or nothing. */
export function dayEnd(day: string): string | undefined {
  const start = dayStart(day)
  return start ? new Date(Date.parse(start) + DAY - 1).toISOString() : undefined
}

/** The date input value (`2026-11-08`) of an ISO datetime, or empty. */
export const dayOf = (iso: string | undefined) => (iso ? iso.slice(0, 10) : '')

/** `filters` with one text filter set (empty clears it). */
export function withText(
  filters: BuildFilters,
  key: (typeof TEXT_KEYS)[number],
  value: string,
): BuildFilters {
  const { [key]: _old, ...rest } = filters
  return value.trim() === '' ? rest : { ...rest, [key]: value.trim() }
}

/** `filters` with the date range set; an empty or invalid day leaves that end open. */
export function withDates(filters: BuildFilters, from: string, to: string): BuildFilters {
  const { from: _f, to: _t, ...rest } = filters
  const start = dayStart(from)
  const end = dayEnd(to)
  return { ...rest, ...(start ? { from: start } : {}), ...(end ? { to: end } : {}) }
}

const FIELD_KEYS: Record<FilterField, readonly (keyof BuildFilters)[]> = {
  status: ['status', 'review'],
  branch: ['branch'],
  author: ['author'],
  reviewer: ['reviewer'],
  name: ['name'],
  date: ['from', 'to'],
}

/** The filters without one field's keys. */
export function without(filters: BuildFilters, field: FilterField): BuildFilters {
  const rest = { ...filters }
  for (const key of FIELD_KEYS[field]) delete rest[key]
  return rest
}

function dateText(filters: BuildFilters): string | undefined {
  const from = dayOf(filters.from)
  const to = dayOf(filters.to)
  if (from && to) return from === to ? from : `${from} to ${to}`
  if (from) return `from ${from}`
  if (to) return `until ${to}`
  return undefined
}

/** What a chip says it filters by: undefined while the field is not filtered. */
export function fieldValue(field: FilterField, filters: BuildFilters): string | undefined {
  switch (field) {
    case 'status':
      return activeState(filters)?.label ?? filters.status ?? filters.review
    case 'date':
      return dateText(filters)
    default:
      return filters[field]
  }
}

/** The chip's accessible name: "Status: Needs review", or just "Status" while unfiltered. */
export function chipName(field: FilterField, filters: BuildFilters): string {
  const label = FILTER_FIELDS.find((f) => f.field === field)?.label ?? field
  const value = fieldValue(field, filters)
  return value ? `${label}: ${value}` : label
}
