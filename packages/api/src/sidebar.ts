import type { Project as ProjectTypes } from './project.ts'
import type { View } from './view.ts'

type ProjectColor = ProjectTypes.Color

export namespace Sidebar {
  export interface Project extends ProjectTypes.MemberSummary {
    slug: string
    name: string
    color: ProjectColor
    icon: string | null
    pinned: boolean
    /** Triage items waiting: not snoozed, not dismissed. */
    triage: number
    /** People in the project. */
    memberCount: number
    /** The first few members by name, up to five. */
    memberPreview: { id: string; name: string; image: string | null }[]
    /** Sites the project hosts: the sidebar's Sites entry is there only when there are some. */
    siteCount: number
    /** Whether the signed-in person belongs to the project (owners and admins see projects they don't). */
    youAreMember: boolean
  }

  /** `GET /api/workspaces/:workspace/sidebar`. */
  export interface Model {
    /** The projects the person may see (all for owners and admins, their own for members): pinned first (in pin order), then the rest A to Z. */
    projects: Project[]
    views: View.Item[]
    /** Unread, awake notifications (across all of the person's workspaces). */
    inboxUnread: number
    /** Open, awake review requests asked of the person in this workspace. */
    reviews: number
    /** Awake triage items assigned to the person in this workspace. */
    triageAssigned: number
    /** Whether this person may change the workspace's settings and its projects' (what the settings pages and their menu entries depend on). */
    canManage: boolean
  }

  /** `PUT`/`DELETE /api/workspaces/:workspace/pinned-projects/:project`. */
  export interface PinResult {
    pinned: boolean
    /** Whether anything changed (false when it was already so). */
    changed: boolean
  }
}
