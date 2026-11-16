import type { Review } from '@circi/api'

import type { SnoozeChoice } from '#lib/snooze.ts'

const without = (list: Review.List, id: string): Review.List => ({
  ...list,
  requests: list.requests.filter((r) => r.id !== id),
})

const change = (list: Review.List, id: string, over: Partial<Review.Request>): Review.List => ({
  ...list,
  requests: list.requests.map((r) => (r.id === id ? { ...r, ...over } : r)),
})

/** A request answered: it leaves every tab but "Reviewed" (which the server fills when it answers). */
export const withRequestClosed = (list: Review.List, id: string): Review.List =>
  list.tab === 'reviewed' ? list : without(list, id)

/** A request dismissed: gone from every tab. */
export const withoutRequest = without

/**
 * A request put off. "For you" drops it at once; the tabs that keep it show it as snoozed
 * (a custom date is known now, the others when the server answers).
 */
export function withRequestSnoozed(
  list: Review.List,
  id: string,
  choice: SnoozeChoice,
): Review.List {
  if (list.tab === 'for-you') return without(list, id)
  if (list.tab === 'snoozed') return list
  return change(list, id, {
    snoozeKind: choice.kind,
    snoozedUntil: choice.kind === 'date' ? choice.date : null,
  })
}

/** A request brought back: it leaves the Snoozed tab, and shows as awake elsewhere. */
export function withRequestAwake(list: Review.List, id: string): Review.List {
  if (list.tab === 'snoozed') return without(list, id)
  return change(list, id, { snoozeKind: null, snoozedUntil: null })
}
