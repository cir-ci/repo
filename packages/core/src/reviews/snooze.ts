import { HOUR_MS, weekStart } from '../builds/insights.ts'
import { ValidationError } from '../errors.ts'

/** Snoozing: when something put off should come back. Shared by review requests and triage. */

export type SnoozeChoice = 'next_push' | 'tomorrow' | 'next_week' | 'date'

/** The hour (UTC) a "tomorrow" or "next week" snooze ends: the start of a working day. */
export const SNOOZE_WAKE_HOUR = 9

/**
 * The moment a snooze ends. `next_push` has none (null: it lasts until the next build);
 * `tomorrow` is 09:00 UTC on the next calendar day, `next_week` 09:00 UTC on the next Monday
 * (always after `now`, even on a Monday), and `date` is the given moment, which must be in the
 * future.
 */
export function snoozeUntil(choice: SnoozeChoice, now: Date, date?: Date | null): Date | null {
  if (choice === 'next_push') return null
  if (choice === 'tomorrow') {
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    return new Date(midnight + 24 * HOUR_MS + SNOOZE_WAKE_HOUR * HOUR_MS)
  }
  if (choice === 'next_week') {
    const monday = weekStart(now).getTime() + 7 * 24 * HOUR_MS
    return new Date(monday + SNOOZE_WAKE_HOUR * HOUR_MS)
  }
  if (!date || Number.isNaN(date.getTime())) throw new ValidationError('Choose a date')
  if (date.getTime() <= now.getTime()) throw new ValidationError('Choose a date in the future')
  return date
}
