import type { BuildStatus, ReviewStatus } from './build.ts'

export type NotificationKind =
  | 'review_requested'
  | 'review_re_requested'
  | 'mentioned'
  | 'build_approved'
  | 'build_rejected'
  | 'review_overdue'
  | 'connection_needs_attention'
  | 'flaky_detected'

export namespace Inbox {
  /** The Inbox's tabs: about you and your work, everything, put off until later. */
  export type Tab = 'for-you' | 'everything' | 'snoozed'

  export interface Item {
    id: string
    kind: NotificationKind
    createdAt: string
    /** Null while unread. */
    readAt: string | null
    snoozedUntil: string | null
    /** Kind-specific details, e.g. `reason` on `build_rejected`, `dueAt` on a request. */
    payload: Record<string, unknown>
    /** Null for the system, or when the person has since left. */
    actor: { id: string; name: string; image: string | null } | null
    /** Null for notices that are not about one build. */
    build: {
      number: number
      /** The build's name; "default" for a team's only build per commit. */
      name: string
      branch: string | null
      prNumber: number | null
      commitSha: string
      status: BuildStatus
      reviewStatus: ReviewStatus
    } | null
    /** How the build's screenshots compare with the baseline; null without a build. */
    changes: { changed: number; added: number; removed: number; unchanged: number } | null
    /** Your open review request for the build: its target (null without one) and how far past it. */
    request: { dueAt: string | null; overdueByMs: number } | null
    team: { slug: string; name: string } | null
    workspace: { slug: string; name: string } | null
    /** The same build also waits for your review on the Reviews page. */
    alsoInReviews: boolean
  }

  /** `GET /api/inbox?tab=…`: newest first, plus the unread count for the sidebar badge. */
  export interface List {
    tab: Tab
    unread: number
    items: Item[]
  }

  /** `GET /api/inbox/unread-count`. */
  export interface UnreadCount {
    unread: number
  }

  /** What changed on one notification. */
  export interface State {
    id: string
    readAt: string | null
    snoozedUntil: string | null
  }

  /** Which emails a person gets, besides the inbox. They are only sent when the instance has SMTP. */
  export interface Preferences {
    emailReviewRequested: boolean
    emailReviewOverdue: boolean
  }
}
