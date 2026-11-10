import type { Team as TeamTypes } from './team.ts'
import type { View } from './view.ts'

type TeamColor = TeamTypes.Color

export namespace Sidebar {
  export interface Team {
    slug: string
    name: string
    color: TeamColor
    icon: string | null
    pinned: boolean
    /** Triage items waiting: not snoozed, not dismissed. */
    triage: number
  }

  /** `GET /api/workspaces/:workspace/sidebar`. */
  export interface Model {
    /** Pinned teams first (in pin order), then the rest A to Z. */
    teams: Team[]
    views: View.Item[]
    /** Unread, awake notifications (across all of the person's workspaces). */
    inboxUnread: number
    /** Open, awake review requests asked of the person in this workspace. */
    reviews: number
    /** Whether this person may change the workspace's settings and its teams' (what the settings pages and their menu entries depend on). */
    canManage: boolean
  }

  /** `PUT`/`DELETE /api/workspaces/:workspace/pinned-teams/:team`. */
  export interface PinResult {
    pinned: boolean
    /** Whether anything changed (false when it was already so). */
    changed: boolean
  }
}
