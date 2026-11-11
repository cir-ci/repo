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

/** How many times a build event is tried before CirCI gives up (a "Send test" event is tried once). */
export const WEBHOOK_ATTEMPTS = 8

export interface DeliveryFacts {
  statusCode: number | null
  error: string | null
  attempt: number
  test: boolean
}

const isOk = (d: DeliveryFacts) =>
  d.statusCode !== null && d.statusCode >= 200 && d.statusCode < 300

/** The answer in a deliveries table: the status code, or why there was none. */
export function deliveryAnswer(d: DeliveryFacts): { text: string; ok: boolean } {
  return {
    text: d.statusCode !== null ? String(d.statusCode) : (d.error ?? 'No answer'),
    ok: isOk(d),
  }
}

/** "3 of 8" (a test event is tried once). */
export const attemptLabel = (d: DeliveryFacts) => `${d.attempt} of ${d.test ? 1 : WEBHOOK_ATTEMPTS}`

/**
 * The badge on a webhook's row, from its newest delivery (null: nothing sent yet). A failing one
 * says what it got and how far through its retries it is.
 */
export function hookStatus(
  newest: DeliveryFacts | undefined,
): { kind: 'none' } | { kind: 'delivered' } | { kind: 'failing'; text: string } {
  if (!newest) return { kind: 'none' }
  if (isOk(newest)) return { kind: 'delivered' }
  const { text } = deliveryAnswer(newest)
  const last = newest.test || newest.attempt >= WEBHOOK_ATTEMPTS
  return {
    kind: 'failing',
    text: last
      ? `Failing: ${text}`
      : `Failing: ${text}, retrying ${newest.attempt}/${WEBHOOK_ATTEMPTS}`,
  }
}
