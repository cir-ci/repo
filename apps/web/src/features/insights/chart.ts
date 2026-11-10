import type { Insights } from '@circi/api'

import { formatHours } from './api.ts'

/**
 * Pure builders for the Insights charts. A chart is drawn in HTML and CSS over a plot of fixed
 * height, so everything here is in percentages of the plot (0 at the baseline, 100 at the top of
 * the axis) and the components only place marks.
 */

export type Bucket = Insights.Report['bucket']

export interface Axis {
  /** The value at the top of the plot. */
  top: number
  /** Gridlines, bottom to top, the last one at the top. */
  ticks: number[]
}

/**
 * An axis that reaches `max`, rounded up to a multiple of `multiple` (never below `min`), with
 * gridlines either every `tickStep` or in 3, 4 or 2 equal whole steps.
 */
export function axisFor(
  max: number,
  options: { multiple: number; min?: number; tickStep?: number },
): Axis {
  const floor = options.min ?? options.multiple
  const top = Math.max(
    floor,
    Math.ceil(Math.max(0, max) / options.multiple - 1e-9) * options.multiple,
  )
  if (options.tickStep !== undefined) {
    const ticks: number[] = []
    for (let v = options.tickStep; v <= top + 1e-9; v += options.tickStep) ticks.push(v)
    return { top, ticks: ticks.length > 0 ? ticks : [top] }
  }
  for (const n of [3, 4, 2]) {
    if (Number.isInteger(top / n))
      return { top, ticks: Array.from({ length: n }, (_, i) => (top / n) * (i + 1)) }
  }
  return { top, ticks: [1, 2, 3].map((i) => (top / 3) * i) }
}

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

/** Where a value sits in the plot, as a percentage of its height. */
export const pct = (value: number, top: number) =>
  top > 0 ? Math.min(100, Math.max(0, (value / top) * 100)) : 0

/** The x of the centre of slot `index` of `count`, as a percentage of the plot's width. */
export const xPct = (index: number, count: number) => ((index + 0.5) / Math.max(1, count)) * 100

/** An axis label: no float noise ("0.30000000000000004"), no trailing zeros. */
export const tickLabel = (value: number) => String(Number(value.toFixed(2)))

export const weekLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** "Mon 10": a day, as the day axis names it. */
export const dayLabel = (iso: string) => {
  const d = new Date(iso)
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  return `${weekday} ${d.getUTCDate()}`
}

/** The ISO week number of a date ("W36"), as the board names weeks. */
export function isoWeek(iso: string): number {
  const d = new Date(iso)
  const day = (d.getUTCDay() + 6) % 7
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3))
  const first = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4))
  return (
    1 +
    Math.round(
      ((thursday.getTime() - first.getTime()) / 86_400_000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7,
    )
  )
}

/** What the axis calls a bucket: "Nov 2" for a week, "Mon 10" for a day. */
export const bucketLabel = (iso: string, bucket: Bucket) =>
  bucket === 'day' ? dayLabel(iso) : weekLabel(iso)

/** What tooltips call a bucket: "W44" for a week, "Mon 10" for a day. */
export const bucketName = (iso: string, bucket: Bucket) =>
  bucket === 'day' ? dayLabel(iso) : `W${isoWeek(iso)}`

/** Which labels fit: every `n`th so that no more than `max` show, always including the last. */
export function labelIndexes(count: number, max = 7): Set<number> {
  const n = Math.ceil(count / max)
  const keep = new Set<number>()
  for (let i = count - 1; i >= 0; i -= n) keep.add(i)
  return keep
}

/** Hours as the axis shows them: hours, or minutes when everything is under an hour. */
export function hoursUnit(maxHours: number): { unit: 'hours' | 'minutes'; factor: number } {
  return maxHours >= 1 ? { unit: 'hours', factor: 1 } : { unit: 'minutes', factor: 60 }
}

export interface Bar {
  label: string
  /** The bucket's name in a tooltip ("W44"). */
  name: string
  height: number
  value: number | null
}

/** Median time to first review per bucket; the axis reaches the target so its line is on the chart. */
export function reviewBars(
  weeks: readonly Insights.Week[],
  goalHours: number | null = null,
  bucket: Bucket = 'week',
) {
  const maxHours = Math.max(0, goalHours ?? 0, ...weeks.map((w) => w.medianReviewHours ?? 0))
  const { unit, factor } = hoursUnit(maxHours)
  const axis = axisFor(maxHours * factor, { multiple: 3 })
  return {
    ...axis,
    unit,
    /** The target line's height; null without one. */
    goalPct: goalHours === null ? null : pct(goalHours * factor, axis.top),
    bars: weeks.map((w): Bar => ({
      label: bucketLabel(w.weekStart, bucket),
      name: bucketName(w.weekStart, bucket),
      height: w.medianReviewHours === null ? 0 : pct(w.medianReviewHours * factor, axis.top),
      value: w.medianReviewHours,
    })),
  }
}

export interface Dot {
  label: string
  name: string
  x: number
  /** Percentage of the plot's height; null where the bucket has no value. */
  y: number | null
  value: number | null
}

export function dots(
  labels: readonly { iso: string; value: number | null }[],
  top: number,
  bucket: Bucket,
): Dot[] {
  return labels.map((l, i) => ({
    label: bucketLabel(l.iso, bucket),
    name: bucketName(l.iso, bucket),
    x: xPct(i, labels.length),
    y: l.value === null ? null : pct(l.value, top),
    value: l.value,
  }))
}

/**
 * An SVG path over a 100 by 100 box (x across, y up from the baseline) through the dots that have
 * a value; a bucket without one breaks the line. With `area`, closed down to the baseline.
 */
export function linePath(points: readonly Dot[], area = false): string {
  const parts: string[] = []
  let run: Dot[] = []
  const flush = () => {
    const [first] = run
    const last = run.at(-1)
    if (first && last) {
      const line = run.map((p, i) => `${i ? 'L' : 'M'}${p.x},${100 - (p.y ?? 0)}`).join(' ')
      parts.push(area ? `${line} L${last.x},100 L${first.x},100 Z` : line)
    }
    run = []
  }
  for (const p of points) {
    if (p.y === null) flush()
    else run.push(p)
  }
  flush()
  return parts.join(' ')
}

/** How a count moved against the one before: fewer is better. */
export type FlakyMove = 'better' | 'worse' | 'same'

/** "▼ 5 since W36": the change from the first week to the last; grey when nothing changed. */
export function flakyDelta(
  weeks: readonly Insights.Week[],
): { text: string; label: string; tone: 'good' | 'bad' | 'neutral' } | null {
  if (weeks.length < 2) return null
  const first = weeks[0]!
  const diff = weeks[weeks.length - 1]!.flaky - first.flaky
  const since = `W${isoWeek(first.weekStart)}`
  if (diff === 0) {
    return {
      text: `● same since ${since}`,
      label: `Unchanged since week ${isoWeek(first.weekStart)}`,
      tone: 'neutral',
    }
  }
  return {
    text: `${diff < 0 ? '▼' : '▲'} ${Math.abs(diff)} since ${since}`,
    label: `${diff < 0 ? 'Down' : 'Up'} ${Math.abs(diff)} since week ${isoWeek(first.weekStart)}, ${diff < 0 ? 'better' : 'worse'}`,
    tone: diff < 0 ? 'good' : 'bad',
  }
}

/** "▲ 9 vs before": failed builds against the stretch before; grey when equal. */
export function failedDelta(
  now: number,
  before: number,
): { text: string; label: string; tone: 'good' | 'bad' | 'neutral' } {
  const diff = now - before
  if (diff === 0) return { text: '● same as before', label: 'Unchanged', tone: 'neutral' }
  return {
    text: `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} vs before`,
    label: `${diff > 0 ? 'Up' : 'Down'} ${Math.abs(diff)}, ${diff > 0 ? 'worse' : 'better'}`,
    tone: diff > 0 ? 'bad' : 'good',
  }
}

export const OUTCOME_KEYS = ['approved', 'autoApproved', 'rejected', 'failed'] as const
export type OutcomeKey = (typeof OUTCOME_KEYS)[number]

export const OUTCOME_LABEL: Record<OutcomeKey, string> = {
  approved: 'Approved',
  autoApproved: 'Auto-approved',
  rejected: 'Rejected',
  failed: 'Failed',
}

export interface StackedBar {
  label: string
  name: string
  total: number
  /** Bottom to top: approved, auto-approved, rejected, failed. Empty segments are left out. */
  segments: { key: OutcomeKey; value: number; height: number }[]
}

/** Outcomes per bucket as stacks, bottom to top, on an axis of 40, 80, 120... */
export function outcomeStacks(weeks: readonly Insights.Week[], bucket: Bucket = 'week') {
  const totals = weeks.map((w) => OUTCOME_KEYS.reduce((sum, k) => sum + w.outcomes[k], 0))
  const axis = axisFor(Math.max(0, ...totals), { multiple: 40 })
  return {
    ...axis,
    bars: weeks.map((w, i): StackedBar => ({
      label: bucketLabel(w.weekStart, bucket),
      name: bucketName(w.weekStart, bucket),
      total: totals[i] ?? 0,
      segments: OUTCOME_KEYS.flatMap((key) =>
        w.outcomes[key] > 0
          ? [{ key, value: w.outcomes[key], height: pct(w.outcomes[key], axis.top) }]
          : [],
      ),
    })),
    empty: totals.every((t) => t === 0),
  }
}

/** "44 approved, 59 auto-approved, 5 rejected, 4 failed": what a stacked bar's tooltip says. */
export const outcomeSentence = (bar: StackedBar) =>
  OUTCOME_KEYS.map((k) => {
    const value = bar.segments.find((s) => s.key === k)?.value ?? 0
    return `${value} ${OUTCOME_LABEL[k].toLowerCase()}`
  }).join(', ')

/** Failed builds per bucket as bars on an axis of whole multiples of 2. */
export function failedBars(weeks: readonly Insights.Week[], bucket: Bucket = 'week') {
  const axis = axisFor(Math.max(0, ...weeks.map((w) => w.failedBuilds)), { multiple: 2 })
  return {
    ...axis,
    bars: weeks.map((w): Bar => ({
      label: bucketLabel(w.weekStart, bucket),
      name: bucketName(w.weekStart, bucket),
      height: pct(w.failedBuilds, axis.top),
      value: w.failedBuilds,
    })),
  }
}

/** Time to decision: median and 90th percentile, on an axis of the next 10 above the 90th. */
export function decisionLines(weeks: readonly Insights.Week[], bucket: Bucket = 'week') {
  const max = Math.max(0, ...weeks.map((w) => w.p90DecisionHours ?? w.medianDecisionHours ?? 0))
  const axis = axisFor(max, { multiple: 10 })
  const pick = (f: (w: Insights.Week) => number | null) =>
    dots(
      weeks.map((w) => ({ iso: w.weekStart, value: f(w) })),
      axis.top,
      bucket,
    )
  return {
    ...axis,
    median: pick((w) => w.medianDecisionHours),
    p90: pick((w) => w.p90DecisionHours),
  }
}

/** Processing time: median and 90th percentile in minutes, on an axis of multiples of 4. */
export function processingLines(weeks: readonly Insights.Week[], bucket: Bucket = 'week') {
  const max = Math.max(
    0,
    ...weeks.map((w) => w.p90ProcessingMinutes ?? w.medianProcessingMinutes ?? 0),
  )
  const axis = axisFor(max, { multiple: 4 })
  const pick = (f: (w: Insights.Week) => number | null) =>
    dots(
      weeks.map((w) => ({ iso: w.weekStart, value: f(w) })),
      axis.top,
      bucket,
    )
  return {
    ...axis,
    median: pick((w) => w.medianProcessingMinutes),
    p90: pick((w) => w.p90ProcessingMinutes),
  }
}

/** The line of open flaky screenshots at the end of each bucket; ticks every 10. */
export function flakyLine(weeks: readonly Insights.Week[], bucket: Bucket = 'week') {
  const axis = axisFor(Math.max(0, ...weeks.map((w) => w.flaky)), {
    multiple: 10,
    tickStep: 10,
  })
  return {
    ...axis,
    points: dots(
      weeks.map((w) => ({ iso: w.weekStart, value: w.flaky })),
      axis.top,
      bucket,
    ),
  }
}

/** Builds waiting at the end of each day; ticks every 5. */
export function backlogLine(backlog: Insights.Report['backlog']) {
  const axis = axisFor(Math.max(0, ...backlog.map((d) => d.waiting)), {
    multiple: 5,
    tickStep: 5,
  })
  return {
    ...axis,
    points: dots(
      backlog.map((d) => ({ iso: d.day, value: d.waiting })),
      axis.top,
      'day',
    ),
    /** Nothing waited on any day: the card says so instead of drawing a flat line. */
    empty: backlog.every((d) => d.waiting === 0),
  }
}

/** The ten cells of a "last 10 builds" strip, oldest left; missing history is padded in front. */
export function stripCells(last10: readonly boolean[]): (boolean | null)[] {
  const pad = Array.from({ length: Math.max(0, 10 - last10.length) }, () => null)
  return [...pad, ...last10.slice(-10)]
}

/** "Changed in 6 of the last 10 builds". */
export const stripLabel = (last10: readonly boolean[], kind: 'changed' | 'flaky' = 'changed') =>
  `${kind === 'flaky' ? 'Flip-flopped' : 'Changed'} in ${last10.filter(Boolean).length} of the last ${Math.min(10, last10.length)} builds`

/** The sentence a screen reader gets for the review chart. */
export function reviewSummary(weeks: readonly Insights.Week[]): string {
  const withData = weeks.filter((w) => w.medianReviewHours !== null)
  if (withData.length === 0) return 'Median time to first review: no reviews in this range.'
  const first = withData[0]!
  const last = withData[withData.length - 1]!
  return `Median time to first review over ${weeks.length} ${weeks.length === 1 ? 'bar' : 'bars'}, from ${formatHours(first.medianReviewHours)} to ${formatHours(last.medianReviewHours)}.`
}

export function flakySummary(weeks: readonly Insights.Week[]): string {
  if (weeks.length === 0) return 'Flaky screenshots: no data.'
  const first = weeks[0]!.flaky
  const last = weeks[weeks.length - 1]!.flaky
  const move = last < first ? 'fell' : last > first ? 'rose' : 'held'
  return `Open flaky screenshots ${move}${last === first ? ` at ${last}` : ` from ${first} to ${last}`} over ${weeks.length} ${weeks.length === 1 ? 'bar' : 'bars'}.`
}

/** Storage bars: each team's share of the largest, with its colour. */
export function storageBars(storage: Insights.Storage) {
  const sorted = storage.teams.toSorted((a, b) => b.bytes - a.bytes)
  const max = sorted[0]?.bytes ?? 0
  return sorted.map((p) => ({
    slug: p.slug,
    name: p.name,
    colour: p.colour,
    icon: p.icon,
    bytes: p.bytes,
    share: max > 0 ? p.bytes / max : 0,
  }))
}

/** A row's bar as a share of the largest value in its list. */
export function shares<T>(rows: readonly T[], value: (row: T) => number): number[] {
  const max = Math.max(0, ...rows.map(value))
  return rows.map((r) => (max > 0 ? value(r) / max : 0))
}
