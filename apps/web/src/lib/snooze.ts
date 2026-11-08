/** What the snooze menu hands back; each page maps it to its own API's body. */
export type SnoozeChoice =
  | { kind: 'next_push' | 'tomorrow' | 'next_week' }
  | { kind: 'date'; date: string }

export interface SnoozeOption {
  kind: 'next_push' | 'tomorrow' | 'next_week' | 'date'
  label: string
}

const OPTIONS: readonly SnoozeOption[] = [
  { kind: 'next_push', label: 'Until next push' },
  { kind: 'tomorrow', label: 'Tomorrow' },
  { kind: 'next_week', label: 'Next week' },
  { kind: 'date', label: 'Custom date' },
]

/** The menu's options in order; notifications snooze to a time only, so they drop "Until next push". */
export function snoozeOptions(allowNextPush: boolean): SnoozeOption[] {
  return OPTIONS.filter((o) => allowNextPush || o.kind !== 'next_push')
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `now` as the `YYYY-MM-DD` a date input takes, in local time. */
export const dateInputValue = (now: Date): string =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

/** The time a custom snooze wakes at on the chosen day (local). */
const WAKE_HOUR = 9

/**
 * A date input's value as the ISO time the snooze runs until (9:00 that day, local), or undefined
 * when it is not a real date or that time is not in the future.
 */
export function customSnoozeDate(value: string, now: Date): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day, WAKE_HOUR)
  const real =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  return real && date.getTime() > now.getTime() ? date.toISOString() : undefined
}
