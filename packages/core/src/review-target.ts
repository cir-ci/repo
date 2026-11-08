/**
 * The review target: how long a review request may wait before it counts as overdue. Pure rules
 * on dates, so the dashboard, the worker's sweep and the tests all agree on the boundaries.
 */

const HOUR_MS = 3_600_000

/**
 * When a request made at `from` is due under a project's target of `targetHours`. Null when the
 * project has no review target, so nothing it asks for can become overdue.
 */
export function reviewDueAt(from: Date, targetHours: number | null): Date | null {
  return targetHours === null ? null : new Date(from.getTime() + targetHours * HOUR_MS)
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
