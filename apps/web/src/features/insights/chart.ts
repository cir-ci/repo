import type { Insights } from '@circi/api'

import { formatHours } from './api.ts'

/** A round top for an axis (1, 2, 5 times a power of ten) and evenly spaced ticks up to it. */
export function niceScale(max: number, tickCount = 3): { top: number; ticks: number[] } {
  if (!(max > 0))
    return { top: tickCount, ticks: Array.from({ length: tickCount }, (_, i) => i + 1) }
  const step = max / tickCount
  const magnitude = 10 ** Math.floor(Math.log10(step))
  const nice = [1, 2, 5, 10].find((m) => m * magnitude >= step - 1e-9)! * magnitude
  return {
    top: nice * tickCount,
    ticks: Array.from({ length: tickCount }, (_, i) => nice * (i + 1)),
  }
}

export interface Plot {
  width: number
  height: number
  left: number
  bottom: number
  top: number
  right: number
}

export const PLOT: Plot = { width: 480, height: 200, left: 36, bottom: 24, top: 8, right: 8 }

/** Maps a value (0 to `top`) to a y in the plot's SVG space. */
export const yAt = (plot: Plot, value: number, top: number) =>
  plot.height - plot.bottom - (value / top) * (plot.height - plot.bottom - plot.top)

/** The x of the centre of slot `index` of `count`. */
export const xAt = (plot: Plot, index: number, count: number) => {
  const inner = plot.width - plot.left - plot.right
  return plot.left + (inner / count) * (index + 0.5)
}

export const weekLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** Which labels fit: every `n`th so that no more than `max` show, always including the last. */
export function labelIndexes(count: number, max = 7): Set<number> {
  const n = Math.ceil(count / max)
  const keep = new Set<number>()
  for (let i = count - 1; i >= 0; i -= n) keep.add(i)
  return keep
}

export interface Bar {
  label: string
  x: number
  y: number
  height: number
  value: number | null
}

/** Bars of the median review time per week; a week with no reviews has no bar. */
export function reviewBars(weeks: readonly Insights.Week[]): {
  top: number
  ticks: number[]
  bars: Bar[]
} {
  const { top, ticks } = niceScale(Math.max(0, ...weeks.map((w) => w.medianReviewHours ?? 0)))
  const base = PLOT.height - PLOT.bottom
  return {
    top,
    ticks,
    bars: weeks.map((w, i) => {
      const y = w.medianReviewHours === null ? base : yAt(PLOT, w.medianReviewHours, top)
      return {
        label: weekLabel(w.weekStart),
        x: xAt(PLOT, i, weeks.length),
        y,
        height: base - y,
        value: w.medianReviewHours,
      }
    }),
  }
}

/** The line of open flaky snapshots at the end of each week. */
export function flakyLine(weeks: readonly Insights.Week[]) {
  const { top, ticks } = niceScale(Math.max(0, ...weeks.map((w) => w.flaky)))
  const points = weeks.map((w, i) => ({
    label: weekLabel(w.weekStart),
    x: xAt(PLOT, i, weeks.length),
    y: yAt(PLOT, w.flaky, top),
    value: w.flaky,
  }))
  return {
    top,
    ticks,
    points,
    path: points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '),
  }
}

/** The sentence a screen reader gets for the review chart. */
export function reviewSummary(weeks: readonly Insights.Week[]): string {
  const withData = weeks.filter((w) => w.medianReviewHours !== null)
  if (withData.length === 0) return 'Median time to review per week: no reviews in this range.'
  const first = withData[0]!
  const last = withData[withData.length - 1]!
  return `Median time to review per week over ${weeks.length} weeks, from ${formatHours(first.medianReviewHours)} to ${formatHours(last.medianReviewHours)}.`
}

export function flakySummary(weeks: readonly Insights.Week[]): string {
  if (weeks.length === 0) return 'Flaky snapshots: no data.'
  const first = weeks[0]!.flaky
  const last = weeks[weeks.length - 1]!.flaky
  const move = last < first ? 'fell' : last > first ? 'rose' : 'held'
  return `Open flaky snapshots ${move}${last === first ? ` at ${last}` : ` from ${first} to ${last}`} over ${weeks.length} weeks.`
}

/** Storage bars: each project's share of the largest. */
export function storageBars(storage: Insights.Storage) {
  const sorted = storage.projects.toSorted((a, b) => b.bytes - a.bytes)
  const max = sorted[0]?.bytes ?? 0
  return sorted.map((p) => ({
    slug: p.slug,
    name: p.name,
    bytes: p.bytes,
    share: max > 0 ? p.bytes / max : 0,
  }))
}
