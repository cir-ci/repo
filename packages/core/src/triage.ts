/** What kind of problem a triage item is. (Integration problems are not recorded yet.) */
export const TRIAGE_KINDS = ['flaky', 'no_baseline', 'failed'] as const
export type TriageKind = (typeof TRIAGE_KINDS)[number]

/** How something was snoozed; `next_push` wakes on the next build of the branch (no end time). */
export const SNOOZE_KINDS = ['next_push', 'tomorrow', 'next_week', 'date'] as const
export type SnoozeKind = (typeof SNOOZE_KINDS)[number]
