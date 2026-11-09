import type { Insights } from '@circi/api'
import { queryOptions } from '@tanstack/react-query'

import { workspacePath } from '#lib/api-paths.ts'
import { getJson } from '#lib/http.ts'
import { keys } from '#lib/query-keys.ts'

export const RANGES = [7, 30, 90] as const
export type RangeDays = (typeof RANGES)[number]

export const RANGE_OPTIONS = RANGES.map((d) => ({ value: String(d), label: `${d} days` }))

export interface InsightsSearch {
  range: RangeDays
  team?: string
}

export const parseRange = (value: unknown): RangeDays =>
  RANGES.find((d) => String(d) === String(value)) ?? 30

/** `?range=7|30|90` (default 30) and `?team=slug`; anything else is dropped. */
export function validateInsightsSearch(search: Record<string, unknown>): InsightsSearch {
  const range = parseRange(search['range'])
  const team = search['team']
  return typeof team === 'string' && team ? { range, team } : { range }
}

const HOUR = 3_600_000

/** The query's `from` and `to`; `to` is the current hour, so the cache key holds for an hour. */
export function rangeBounds(days: RangeDays, now: number): { from: string; to: string } {
  const to = Math.floor(now / HOUR) * HOUR
  return { from: new Date(to - days * 24 * HOUR).toISOString(), to: new Date(to).toISOString() }
}

export const insightsQuery = (workspace: string, search: InsightsSearch, now = Date.now()) => {
  const { from, to } = rangeBounds(search.range, now)
  const params = new URLSearchParams({ from, to })
  if (search.team) params.set('team', search.team)
  return queryOptions({
    queryKey: keys.insights(workspace, search.team ?? null, from, to),
    queryFn: () => getJson<Insights.Report>(`${workspacePath(workspace, 'insights')}?${params}`),
  })
}

/** "3.4h", "42m", "2.1d"; a dash for no data. */
export function formatHours(hours: number | null): string {
  if (hours === null) return '–'
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours >= 48) return `${(hours / 24).toFixed(1)}d`
  return hours < 10 ? `${hours.toFixed(1)}h` : `${Math.round(hours)}h`
}

/** "512 B", "1.5 KB", "41.2 GB" (powers of 1024). */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

export const formatPercent = (rate: number | null) =>
  rate === null ? '–' : `${Math.round(rate * 100)}%`

export interface Delta {
  direction: 'up' | 'down' | 'flat'
  /** Whether the move is good, bad, or just a fact. */
  tone: 'good' | 'bad' | 'neutral'
  /** Short, with the arrow: "▼ 44%". */
  text: string
  /** Full words for assistive tech. */
  label: string
}

/**
 * How `current` moved against `previous`: a percentage for amounts, points for rates. With
 * nothing to compare against the delta is flat.
 */
export function delta(
  current: number | null,
  previous: number | null,
  options: { better: 'lower' | 'higher' | 'none'; unit?: 'percent' | 'points' },
): Delta {
  const flat: Delta = {
    direction: 'flat',
    tone: 'neutral',
    text: '● no change',
    label: 'Unchanged',
  }
  if (current === null || previous === null)
    return { ...flat, text: '● no comparison', label: 'No earlier data to compare' }
  const diff = current - previous
  if (Math.abs(diff) < 1e-9) return flat
  const direction = diff > 0 ? 'up' : 'down'
  let amount: string
  if (options.unit === 'points') amount = `${Math.round(Math.abs(diff) * 100)} points`
  else if (previous === 0) amount = 'new'
  else amount = `${Math.round((Math.abs(diff) / previous) * 100)}%`
  if (options.unit === 'points' && amount === '0 points') return flat
  const short = amount.replace(' points', ' pts')
  const improved =
    options.better === 'none' ? undefined : diff > 0 === (options.better === 'higher')
  const tone = improved === undefined ? 'neutral' : improved ? 'good' : 'bad'
  const word = improved === undefined ? '' : improved ? ', better' : ', worse'
  return {
    direction,
    tone,
    text: `${direction === 'up' ? '▲' : '▼'} ${short}`,
    label: `${direction === 'up' ? 'Up' : 'Down'} ${amount}${word}`,
  }
}

export interface Tile {
  id: string
  title: string
  value: string
  delta: Delta
  note: string
}

export function tiles(report: Insights.Report, days: number): Tile[] {
  const s = report.summary
  const p = report.previous
  const hasReviews = s.buildsReviewed > 0
  const median = hasReviews ? s.medianReviewHours : null
  const earlier = `vs the ${days} days before`
  return [
    {
      id: 'median',
      title: 'Median time to review',
      value: formatHours(median),
      delta: delta(median, p.medianReviewHours, { better: 'lower' }),
      note: hasReviews
        ? `90th percentile ${formatHours(s.p90ReviewHours)}${p.medianReviewHours === null ? '' : `, ${earlier}`}`
        : `No reviews in the last ${days} days`,
    },
    {
      id: 'reviewed',
      title: 'Builds reviewed',
      value: String(s.buildsReviewed),
      delta: delta(s.buildsReviewed, p.buildsReviewed, { better: 'none' }),
      note: `in the last ${days} days`,
    },
    {
      id: 'changes',
      title: 'Builds with changes',
      value: formatPercent(s.changeRate),
      delta: delta(s.changeRate, p.changeRate, { better: 'none', unit: 'points' }),
      note: `${s.buildsWithChanges} of ${s.buildsFinished} finished builds`,
    },
    {
      id: 'over',
      title: 'Reviews over target',
      value: String(s.reviewedOverTarget),
      delta: delta(s.reviewedOverTarget, p.reviewedOverTarget, { better: 'lower' }),
      note: `of ${s.buildsReviewed} reviewed, waited past the team's target`,
    },
  ]
}

/** Nothing reviewed, finished or stored in the range. */
export const isEmpty = (report: Insights.Report) =>
  report.summary.buildsFinished === 0 &&
  report.summary.buildsReviewed === 0 &&
  report.storage.totalBytes === 0 &&
  report.reviewers.length === 0
