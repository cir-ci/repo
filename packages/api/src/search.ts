import type { NotificationKind } from './notification.ts'

export namespace Search {
  /** The kinds of result, named as the keys of `Results`. */
  export type Kind =
    | 'builds'
    | 'branches'
    | 'projects'
    | 'snapshots'
    | 'baselines'
    | 'triage'
    | 'notifications'
    | 'reviews'
    | 'views'
    | 'people'

  export interface Build {
    projectslug: string
    projectName: string
    number: number
    name: string
    branch: string | null
    prNumber: number | null
    status: 'pending' | 'uploading' | 'processing' | 'complete' | 'error' | 'expired'
    reviewStatus: 'pending' | 'approved' | 'rejected'
    /** How many screenshots changed, were added or were removed. */
    changes: { changed: number; added: number; removed: number }
    /** The file (a thumbnail, by SHA-256) of the build's largest change; null when nothing changed. */
    thumbnail: string | null
  }

  export interface Branch {
    projectslug: string
    projectName: string
    branch: string
    latestBuildNumber: number
  }

  export interface Project {
    slug: string
    name: string
  }

  export interface Snapshot {
    projectslug: string
    projectName: string
    name: string
    latestBuildNumber: number
    /** The newest screenshot's thumbnail file. */
    thumbnail: string | null
  }

  /** A screenshot that is a baseline (on the project's default branch), opening its baseline page. */
  export interface Baseline {
    projectslug: string
    projectName: string
    name: string
    /** The default-branch build the baseline comes from. */
    buildNumber: number
    thumbnail: string | null
    /** Who approved it; null for an automatic approval. */
    approvedBy: string | null
  }

  /** A triage item of a project (the page's `kind:key` identifies it). */
  export interface Triage {
    projectslug: string
    projectName: string
    kind: 'flaky' | 'no_baseline' | 'failed'
    key: string
    /** The screenshot it is about; null for a failed build. */
    snapshotName: string | null
    buildNumber: number
    branch: string | null
    assignee: { name: string } | null
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
    project: { slug: string; name: string } | null
    /** The words kept with the notification that the row shows. */
    payload: { snippet?: string; reason?: string; cc?: boolean }
  }

  /** An open review request that was asked of the person or by them. */
  export interface Review {
    id: string
    /** The Reviews tab that lists it for them. */
    tab: 'for-you' | 'created' | 'snoozed'
    projectslug: string
    projectName: string
    build: { number: number; name: string; branch: string | null }
    reviewer: { name: string }
    requestedBy: { name: string } | null
    /** ISO time it was asked. */
    createdAt: string
  }

  /** A person of the workspace the signed-in person may see (opening one lists their review requests). */
  export interface Person {
    id: string
    name: string
    email: string
    image: string | null
    /** The projects they belong to that the signed-in person can see. */
    projects: { slug: string; name: string }[]
    /** Open review requests asked of them, in those projects. */
    openReviews: number
  }

  /** One of the person's saved views. */
  export interface View {
    id: string
    name: string
    project: { slug: string; name: string } | null
  }

  /**
   * `GET /api/workspaces/:workspace/search?q=&project=&kinds=&limit=`: matches grouped, each group
   * limited (`limit`, 5 by default, 50 at most). `project` (a slug) keeps to that project; `kinds` (comma
   * separated keys of this type) asks for those kinds only, the others come back empty.
   */
  export interface Results {
    query: string
    builds: Build[]
    branches: Branch[]
    projects: Project[]
    snapshots: Snapshot[]
    baselines: Baseline[]
    triage: Triage[]
    notifications: Notification[]
    reviews: Review[]
    views: View[]
    people: Person[]
    /** How many match in all per kind, so a group cut at the limit can say "Show all 12 builds". */
    totals: Record<Kind, number>
  }
}
