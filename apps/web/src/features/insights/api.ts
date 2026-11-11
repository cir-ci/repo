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
  project?: string
  /** Each sorted table's sort: `projects:-builds,reviewers:name` (see `lib/sort.ts`). */
  sort?: string
}

export const parseRange = (value: unknown): RangeDays =>
  RANGES.find((d) => String(d) === String(value)) ?? 30

/** `?range=7|30|90` (default 30), `?project=slug` and `?sort=`; anything else is dropped. */
export function validateInsightsSearch(search: Record<string, unknown>): InsightsSearch {
  const range = parseRange(search['range'])
  const project = search['project']
  const sort = search['sort']
  return {
    range,
    ...(typeof project === 'string' && project ? { project } : {}),
    ...(typeof sort === 'string' && sort ? { sort } : {}),
  }
}

const HOUR = 3_600_000

/**
 * The query's `from` and `to`; `to` is the end of the current hour, so the cache key holds for an
 * hour and builds and reviews from the last minutes are inside the range (the end is exclusive).
 */
export function rangeBounds(days: RangeDays, now: number): { from: string; to: string } {
  const to = (Math.floor(now / HOUR) + 1) * HOUR
  return { from: new Date(to - days * 24 * HOUR).toISOString(), to: new Date(to).toISOString() }
}

export const insightsQuery = (workspace: string, search: InsightsSearch, now = Date.now()) => {
  const { from, to } = rangeBounds(search.range, now)
  const params = new URLSearchParams({ from, to })
  if (search.project) params.set('project', search.project)
  return queryOptions({
    queryKey: keys.insights(workspace, search.project ?? null, from, to),
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
  /** Short, with the arrow: "▼ 2.7h · 44%". */
  text: string
  /** Full words for assistive tech. */
  label: string
}

/** "2.7 hours", "30 minutes": a duration in words, for assistive tech. */
function hoursInWords(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} minutes`
  return hours >= 48 ? `${(hours / 24).toFixed(1)} days` : `${Number(hours.toFixed(1))} hours`
}

/** "1,284": counts with their thousands separator. */
export const formatCount = (n: number) => n.toLocaleString('en-US')

/**
 * How `current` moved against `previous`: a percentage for amounts, points for rates, hours with a
 * percentage for durations, or the plain difference for counts. With nothing to compare against
 * the delta is flat.
 */
export function delta(
  current: number | null,
  previous: number | null,
  options: {
    better: 'lower' | 'higher' | 'none'
    unit?: 'percent' | 'points' | 'hours' | 'count'
  },
): Delta {
  const flat: Delta = {
    direction: 'flat',
    tone: 'neutral',
    text: '● same as before',
    label: 'Unchanged',
  }
  if (current === null || previous === null)
    return { ...flat, text: '● no comparison', label: 'No earlier data to compare' }
  const diff = current - previous
  if (Math.abs(diff) < 1e-9) return flat
  const direction = diff > 0 ? 'up' : 'down'
  const size = Math.abs(diff)
  const percent = previous === 0 ? 'new' : `${Math.round((size / previous) * 100)}%`
  let short: string
  let words: string
  if (options.unit === 'points') {
    if (Math.round(size * 100) === 0) return flat
    short = `${Math.round(size * 100)} points`
    words = short
  } else if (options.unit === 'count') {
    short = String(size)
    words = short
  } else if (options.unit === 'hours') {
    short = previous === 0 ? formatHours(size) : `${formatHours(size)} · ${percent}`
    words = hoursInWords(size)
  } else {
    short = percent
    words = percent
  }
  const improved =
    options.better === 'none' ? undefined : diff > 0 === (options.better === 'higher')
  const tone = improved === undefined ? 'neutral' : improved ? 'good' : 'bad'
  const word = improved === undefined ? '' : improved ? ', better' : ', worse'
  return {
    direction,
    tone,
    text: `${direction === 'up' ? '▲' : '▼'} ${short}`,
    label: `${direction === 'up' ? 'Up' : 'Down'} ${words}${word}`,
  }
}

export interface Tile {
  id: string
  title: string
  value: string
  delta: Delta
  note: string
}

/** The share of reviews that came within their project's target; null when none had a target. */
export function targetHitRate(s: Insights.Summary): number | null {
  return s.reviewedWithTarget === 0 ? null : 1 - s.reviewedOverTarget / s.reviewedWithTarget
}

export function tiles(report: Insights.Report, days: number): Tile[] {
  const s = report.summary
  const p = report.previous
  const hasReviews = s.buildsReviewed > 0
  const median = hasReviews ? s.medianReviewHours : null
  const decided = s.buildsDecided > 0
  const decision = decided ? s.medianDecisionHours : null
  const earlier = `vs the ${days} days before`
  const hit = targetHitRate(s)
  const failedShare = s.buildsFinished + s.failedBuilds
  return [
    {
      id: 'median',
      title: 'Median time to first review',
      value: formatHours(median),
      delta: delta(median, p.medianReviewHours, { better: 'lower', unit: 'hours' }),
      note: hasReviews
        ? `90th percentile ${formatHours(s.p90ReviewHours)}${p.medianReviewHours === null ? '' : `, ${earlier}`}`
        : `No reviews in the last ${days} days`,
    },
    {
      id: 'decision',
      title: 'Median time to decision',
      value: formatHours(decision),
      delta: delta(decision, p.buildsDecided > 0 ? p.medianDecisionHours : null, {
        better: 'lower',
        unit: 'hours',
      }),
      note: decided
        ? `90th percentile ${formatHours(s.p90DecisionHours)}, build ready to approved or rejected`
        : `No builds were decided in the last ${days} days`,
    },
    {
      id: 'target',
      title: 'First reviews within target',
      value: formatPercent(hit),
      delta: delta(hit, targetHitRate(p), { better: 'higher', unit: 'points' }),
      note:
        hit === null
          ? report.reviewTargetHours === null && hasReviews
            ? 'No review target set'
            : `No reviews in the last ${days} days`
          : `${formatCount(s.reviewedWithTarget - s.reviewedOverTarget)} of ${formatCount(s.reviewedWithTarget)} reviews, weekends not counted`,
    },
    {
      id: 'reviewed',
      title: 'Builds reviewed',
      value: formatCount(s.buildsReviewed),
      delta: delta(s.buildsReviewed, p.buildsReviewed, { better: 'none' }),
      note: `in the last ${days} days`,
    },
    {
      id: 'changes',
      title: 'Builds with changes',
      value: formatPercent(s.changeRate),
      delta: delta(s.changeRate, p.changeRate, { better: 'none', unit: 'points' }),
      note: `${formatCount(s.buildsWithChanges)} of ${formatCount(s.buildsFinished)} finished builds`,
    },
    {
      id: 'failed',
      title: 'Failed builds',
      value: formatCount(s.failedBuilds),
      delta: delta(s.failedBuilds, p.failedBuilds, { better: 'lower', unit: 'count' }),
      note:
        failedShare === 0
          ? `No builds finished in the last ${days} days`
          : `${((s.failedBuilds / failedShare) * 100).toFixed(1)}% of finished builds`,
    },
  ]
}

/** Nothing reviewed, finished or stored in the range. */
export const isEmpty = (report: Insights.Report) =>
  report.summary.buildsFinished === 0 &&
  report.summary.buildsReviewed === 0 &&
  report.summary.failedBuilds === 0 &&
  report.storage.totalBytes === 0 &&
  report.reviewers.length === 0

/** "90 days", or "30 to 90 days" when the projects in view keep builds for different times. */
export const retentionSpan = (days: { min: number; max: number }) =>
  days.min === days.max ? `${days.min} days` : `${days.min} to ${days.max} days`

/** "2d 6h" past a day, else "9h" (or "40m"): how long something has waited. */
export function formatWait(ms: number): string {
  const hours = Math.max(0, ms) / HOUR
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${Math.floor(hours)}h`
  const days = Math.floor(hours / 24)
  const rest = Math.floor(hours - days * 24)
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`
}

/** The range, as card sub-titles say it: "last 90 days". */
export const rangeLabel = (days: number) => `last ${days} days`

/** "1 rejection", "5 rejections". */
export const rejectionsLabel = (n: number) => `${n} ${n === 1 ? 'rejection' : 'rejections'}`
