const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** "3 minutes ago", "yesterday", "just now" (under a minute either way): `iso` relative to `now`. */
export function formatRelative(iso: string, now: number): string {
  const seconds = (new Date(iso).getTime() - now) / 1000
  const unit = UNITS.find(([, s]) => Math.abs(seconds) >= s)
  return unit ? rtf.format(Math.round(seconds / unit[1]), unit[0]) : 'just now'
}
