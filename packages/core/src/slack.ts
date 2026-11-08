/**
 * What the Slack integration can tell a channel about. A project's mapping stores the chosen
 * events in `integration_projects.extra.events`; this file is the one place that reads them.
 * Pure and free of Node APIs, so the dashboard imports it too (`@circi/core/slack`).
 */

export const SLACK_EVENTS = [
  'review_requested',
  'review_overdue',
  'build_rejected',
  'build_approved',
] as const

export type SlackEvent = (typeof SLACK_EVENTS)[number]

/** What a person sees next to each event. */
export const SLACK_EVENT_LABEL: Record<SlackEvent, string> = {
  review_requested: 'Review requested',
  review_overdue: 'Review overdue',
  build_rejected: 'Build rejected',
  build_approved: 'Build approved',
}

/** On by default for a newly mapped project: what needs someone to act. Approvals are opt-in. */
export const SLACK_DEFAULT_EVENTS: readonly SlackEvent[] = [
  'review_requested',
  'review_overdue',
  'build_rejected',
]

export const isSlackEvent = (value: unknown): value is SlackEvent =>
  typeof value === 'string' && (SLACK_EVENTS as readonly string[]).includes(value)

/**
 * The events a mapping sends, from its stored `extra`. A mapping without a list (an older or
 * hand-made row) sends the defaults; unknown names are dropped.
 */
export function slackEventsOf(extra: Record<string, unknown> | null | undefined): SlackEvent[] {
  const events = extra?.events
  if (!Array.isArray(events)) return [...SLACK_DEFAULT_EVENTS]
  return SLACK_EVENTS.filter((e) => events.includes(e))
}

/** A Slack channel id: public channels start with C, private ones with G. */
export const SLACK_CHANNEL_ID_RE = /^[CG][A-Z0-9]{2,30}$/
