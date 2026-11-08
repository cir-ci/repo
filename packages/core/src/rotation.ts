import { WEEK_MS, weekStart } from './insights.ts'

/**
 * The triage rotation: members take turns, one calendar week each (Monday to Sunday, UTC),
 * starting with the first member in the week that contains `startsOn`.
 */

/**
 * Who is on triage at `date`. Null for an empty rotation. Before the start week the rotation
 * counts backwards (the last member is on triage the week before the first), so there is always
 * someone.
 */
export function rotationFor<T>(date: Date, members: readonly T[], startsOn: Date): T | null {
  if (members.length === 0) return null
  const weeks = Math.round((weekStart(date).getTime() - weekStart(startsOn).getTime()) / WEEK_MS)
  const index = ((weeks % members.length) + members.length) % members.length
  return members[index] ?? null
}

/** The Monday at which the person on triage at `date` hands over. */
export function rotationHandover(date: Date): Date {
  return new Date(weekStart(date).getTime() + WEEK_MS)
}
