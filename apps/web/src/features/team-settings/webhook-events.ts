/** What each event means, as the add dialog says it; an event the server adds later has none. */
const DESCRIPTIONS: Record<string, string> = {
  'build.completed': 'A build finished processing, with its conclusion.',
  'build.reviewed': 'Someone approved or rejected a build.',
}

export const eventDescription = (event: string): string | undefined => DESCRIPTIONS[event]

/** What is wrong with the add form, if anything; both problems are reported together. */
export function webhookProblems(url: string, events: readonly string[]) {
  return {
    url: url.trim() ? null : 'Enter an address',
    events: events.length === 0 ? 'Choose at least one event' : null,
  }
}

/** How one delivery attempt reads in the list: the answer, or why there was none. */
export function describeDelivery(d: {
  statusCode: number | null
  error: string | null
  attempt: number
  test: boolean
}): { text: string; ok: boolean } {
  const ok = d.statusCode !== null && d.statusCode >= 200 && d.statusCode < 300
  const result = d.statusCode !== null ? String(d.statusCode) : (d.error ?? 'No answer')
  const parts = [ok ? `${result} delivered` : `${result} failed`]
  if (d.attempt > 1) parts.push(`attempt ${d.attempt}`)
  if (d.test) parts.push('test')
  return { text: parts.join(', '), ok }
}
