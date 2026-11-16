/** `GET /api/live`: a stream of server-sent events that tell an open dashboard what to refetch. */
export namespace Live {
  /**
   * What happened. Everything but `resync` mirrors a `LiveNoticeType` in `@circi/core`
   * (`contract-check.ts` pins that). `resync` is never sent: the dashboard makes it up itself
   * when it may have missed events (the stream reconnected, the tab came back), and refetches
   * everything on screen.
   */
  export type EventType =
    | 'build.created'
    | 'build.finalized'
    | 'build.updated'
    | 'review.changed'
    | 'comment.changed'
    | 'notification.created'
    | 'notification.read'
    | 'triage.changed'
    | 'resync'

  /** One event: where it happened, by the slugs and build number the dashboard's routes use. No data: the page refetches. */
  export interface Event {
    type: EventType
    workspace?: string
    project?: string
    build?: number
  }
}
