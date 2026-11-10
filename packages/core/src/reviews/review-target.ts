/**
 * The review target: how long a review request may wait before it counts as overdue. Pure rules
 * on dates, so the dashboard, the worker's sweep and the tests all agree on the boundaries.
 */

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/**
 * When a request made at `from` is due under a team's target of `targetHours`, counting working
 * days: Saturday and Sunday (UTC) don't count, so 24 hours from Friday 16:00 is Monday 16:00.
 * Null when the team has no review target, so nothing it asks for can become overdue.
 */
export function reviewDueAt(from: Date, targetHours: number | null): Date | null {
  if (targetHours === null) return null
  let cursor = from.getTime()
  let left = targetHours * HOUR_MS
  while (left > 0) {
    const day = new Date(cursor).getUTCDay()
    const midnight = Date.UTC(
      new Date(cursor).getUTCFullYear(),
      new Date(cursor).getUTCMonth(),
      new Date(cursor).getUTCDate(),
    )
    if (day === 6 || day === 0) {
      // Weekend: skip to the next Monday 00:00.
      cursor = midnight + (day === 6 ? 2 : 1) * DAY_MS
      continue
    }
    // Working time left before Saturday 00:00.
    const untilWeekend = midnight + (6 - day) * DAY_MS - cursor
    const step = Math.min(left, untilWeekend)
    cursor += step
    left -= step
  }
  // Working time that runs out exactly at the weekend's start is due when the week resumes.
  const day = new Date(cursor).getUTCDay()
  if (day === 6) cursor += 2 * DAY_MS
  else if (day === 0) cursor += DAY_MS
  return new Date(cursor)
}

/**
 * Whether a request is overdue at `now`: strictly after its due time (exactly due is still on
 * time). Never without a due time, and not while it is snoozed.
 */
export function isOverdue(dueAt: Date | null, now: Date, snoozed = false): boolean {
  return dueAt !== null && !snoozed && now.getTime() > dueAt.getTime()
}

/** How many milliseconds past its due time a request is; 0 when it is not overdue. */
export function overdueBy(dueAt: Date | null, now: Date, snoozed = false): number {
  return dueAt !== null && isOverdue(dueAt, now, snoozed) ? now.getTime() - dueAt.getTime() : 0
}

/**
 * Whether a request is snoozed at `now`. A timed snooze ends at `snoozedUntil`; "until next
 * push" has a kind but no end time and lasts until a newer build closes the request.
 */
export function isSnoozed(
  snooze: { snoozedUntil: Date | null; snoozeKind: string | null },
  now: Date,
): boolean {
  if (snooze.snoozeKind === null) return false
  return snooze.snoozedUntil === null || snooze.snoozedUntil.getTime() > now.getTime()
}
