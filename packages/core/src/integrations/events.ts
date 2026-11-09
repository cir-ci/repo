/**
 * The domain events integrations can hear about: a closed union, so a definition lists the ones it
 * handles and the compiler catches a typo. A service queues an event once (`queueIntegrationEvent`
 * in `@circi/services`) and CirCI fans it out to every integration of the workspace that
 * handles it and whose mapping wants it. Pure and free of Node APIs.
 */

export const INTEGRATION_EVENTS = [
  'review.requested',
  'review.overdue',
  'build.rejected',
  'build.approved',
  'build.completed',
] as const

export namespace IntegrationEvent {
  export type Type = (typeof INTEGRATION_EVENTS)[number]

  /** What happened, as stored in the job. Dates are ISO strings. */
  export interface Payload {
    type: Type
    buildId: string
    /** Who was asked to review (requested, overdue) or who decided (rejected, approved). */
    reviewerId?: string | null
    /** Who asked, for a review request. */
    actorId?: string | null
    /** The review request, so a later request for the same build and reviewer is not deduplicated. */
    requestId?: string | null
    /** Why the changes were rejected. */
    reason?: string | null
    dueAt?: string | null
    /** A request to someone who had asked before. */
    again?: boolean
  }
}

/** What a person sees next to each event. */
export const INTEGRATION_EVENT_LABEL: Record<IntegrationEvent.Type, string> = {
  'review.requested': 'Review requested',
  'review.overdue': 'Review overdue',
  'build.rejected': 'Build rejected',
  'build.approved': 'Build approved',
  'build.completed': 'Build completed',
}

export const isIntegrationEvent = (value: unknown): value is IntegrationEvent.Type =>
  typeof value === 'string' && (INTEGRATION_EVENTS as readonly string[]).includes(value)
