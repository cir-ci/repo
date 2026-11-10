import { WEEK_MS, weekStart } from '../builds/insights.ts'

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

/** What a workspace says when it has never been asked: nobody is assigned triage items on their own. */
export const DEFAULT_ASSIGN_TRIAGE_TO_ON_CALL = false

/**
 * Whether new triage items go to whoever is on triage. The team's own value wins; `null` means
 * "inherit from the workspace".
 */
export function resolveAssignTriageToOnCall(workspace: boolean, team: boolean | null): boolean {
  return team ?? workspace
}
