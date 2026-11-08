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
