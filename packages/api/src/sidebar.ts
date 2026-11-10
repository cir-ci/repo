import type { Team as TeamTypes } from './team.ts'
import type { View } from './view.ts'

type TeamColor = TeamTypes.Color

export namespace Sidebar {
  export interface Team extends TeamTypes.MemberSummary {
    slug: string
    name: string
    color: TeamColor
    icon: string | null
    pinned: boolean
    /** Triage items waiting: not snoozed, not dismissed. */
    triage: number
    /** People in the team. */
    memberCount: number
    /** The first few members by name, up to five. */
    memberPreview: { id: string; name: string; image: string | null }[]
    /** Whether the signed-in person belongs to the team (owners and admins see teams they don't). */
    youAreMember: boolean
  }

  /** `GET /api/workspaces/:workspace/sidebar`. */
  export interface Model {
    /** The teams the person may see (all for owners and admins, their own for members): pinned first (in pin order), then the rest A to Z. */
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
