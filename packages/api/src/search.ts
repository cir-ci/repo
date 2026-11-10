import type { NotificationKind } from './notification.ts'

export namespace Search {
  /** The kinds of result, named as the keys of `Results`. */
  export type Kind =
    | 'builds'
    | 'branches'
    | 'teams'
    | 'snapshots'
    | 'baselines'
    | 'triage'
    | 'notifications'
    | 'reviews'
    | 'views'

  export interface Build {
    teamSlug: string
    teamName: string
    number: number
    name: string
    branch: string | null
    prNumber: number | null
    status: 'pending' | 'uploading' | 'processing' | 'complete' | 'error' | 'expired'
    reviewStatus: 'pending' | 'approved' | 'rejected'
  }

  export interface Branch {
    teamSlug: string
    teamName: string
    branch: string
    latestBuildNumber: number
  }

  export interface Team {
    slug: string
    name: string
  }

  export interface Snapshot {
    teamSlug: string
    teamName: string
    name: string
    latestBuildNumber: number
  }

  /** A screenshot that is a baseline (on the team's default branch), opening its baseline page. */
  export interface Baseline {
    teamSlug: string
    teamName: string
    name: string
    /** The default-branch build the baseline comes from. */
    buildNumber: number
  }

  /** A triage item of a team (the page's `kind:key` identifies it). */
  export interface Triage {
    teamSlug: string
    teamName: string
    kind: 'flaky' | 'no_baseline' | 'failed'
    key: string
    /** The screenshot it is about; null for a failed build. */
    snapshotName: string | null
    buildNumber: number
    branch: string | null
  }

  /** One of the signed-in person's notifications (deleted ones never match). */
  export interface Notification {
    id: string
    kind: NotificationKind
    /** The Inbox tab that lists it: Snoozed while it is asleep, else Everything. */
    tab: 'everything' | 'snoozed'
    read: boolean
    createdAt: string
    actor: { name: string } | null
    build: { number: number; name: string } | null
    team: { slug: string; name: string } | null
    /** The words kept with the notification that the row shows. */
    payload: { snippet?: string; reason?: string; cc?: boolean }
  }

  /** An open review request that was asked of the person or by them. */
  export interface Review {
    id: string
    /** The Reviews tab that lists it for them. */
    tab: 'for-you' | 'created' | 'snoozed'
    teamSlug: string
    teamName: string
    build: { number: number; name: string; branch: string | null }
    reviewer: { name: string }
    requestedBy: { name: string } | null
  }

  /** One of the person's saved views. */
  export interface View {
    id: string
    name: string
    team: { slug: string; name: string } | null
  }

  /**
   * `GET /api/workspaces/:workspace/search?q=&team=&kinds=&limit=`: matches grouped, each group
   * limited (`limit`, 5 by default, 50 at most). `team` (a slug) keeps to that team; `kinds` (comma
   * separated keys of this type) asks for those kinds only, the others come back empty.
   */
  export interface Results {
    query: string
    builds: Build[]
    branches: Branch[]
    teams: Team[]
    snapshots: Snapshot[]
    baselines: Baseline[]
    triage: Triage[]
    notifications: Notification[]
    reviews: Review[]
    views: View[]
    /** How many match in all per kind, so a group cut at the limit can say "Show all 12 builds". */
    totals: Record<Kind, number>
  }
}
