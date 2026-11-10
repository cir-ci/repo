/**
 * Arithmetic behind the Insights screen, pure so the boundaries are pinned by tests: percentiles
 * and the weeks the charts bucket by.
 */

export const HOUR_MS = 3_600_000
export const WEEK_MS = 7 * 24 * HOUR_MS

/**
 * The `p`th percentile (0 to 1) of `values`, interpolating between neighbours like Postgres's
 * `percentile_cont`. Null for no values.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = values.toSorted((a, b) => a - b)
  const rank = Math.min(Math.max(p, 0), 1) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  const a = sorted[lo] ?? 0
  const b = sorted[hi] ?? a
  return a + (b - a) * (rank - lo)
}

export const median = (values: readonly number[]): number | null => percentile(values, 0.5)

/** Midnight UTC of the Monday on or before `date`: the start of its week. */
export function weekStart(date: Date): Date {
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  const sinceMonday = (new Date(day).getUTCDay() + 6) % 7
  return new Date(day - sinceMonday * 24 * HOUR_MS)
}

/** The starts of every week that `[from, to)` touches, oldest first. */
export function weeksBetween(from: Date, to: Date): Date[] {
  const weeks: Date[] = []
  for (let w = weekStart(from).getTime(); w < to.getTime(); w += WEEK_MS) weeks.push(new Date(w))
  return weeks
}
