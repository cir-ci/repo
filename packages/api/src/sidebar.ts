import type { View } from './view.ts'

export namespace Sidebar {
  export interface Project {
    slug: string
    name: string
    pinned: boolean
    /** Triage items waiting: not snoozed, not dismissed. */
    triage: number
  }

  /** `GET /api/orgs/:org/sidebar`. */
  export interface Model {
    /** Pinned projects first (in pin order), then the rest A to Z. */
    projects: Project[]
    views: View.Item[]
    /** Unread, awake notifications (across all of the person's organizations). */
    inboxUnread: number
    /** Open, awake review requests asked of the person in this organization. */
    reviews: number
  }

  /** `PUT`/`DELETE /api/orgs/:org/pinned-projects/:project`. */
  export interface PinResult {
    pinned: boolean
    /** Whether anything changed (false when it was already so). */
    changed: boolean
  }
}
