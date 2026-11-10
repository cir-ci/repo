import type { BuildConclusion, BuildStatus, ReviewStatus } from './build.ts'

export type ReviewRequestState = 'open' | 'done' | 'superseded' | 'dismissed'
export type SnoozeKind = 'next_push' | 'tomorrow' | 'next_week' | 'date'

export namespace Review {
  /**
   * The Reviews page's tabs: asked of you, asked by you, asked of you and put off, asked of you
   * and closed since (latest 50), every open request in the workspace.
   */
  export type Tab = 'for-you' | 'created' | 'snoozed' | 'reviewed' | 'all-open'

  /**
   * Why a request is not a first ask: the reviewer rejected an earlier build of the branch, or
   * was asked about this build before.
   */
  export type Reason = { kind: 'rejected_earlier'; buildNumber: number } | { kind: 're_requested' }

  /** Someone asked to review a build. */
  export interface Request {
    id: string
    state: ReviewRequestState
    createdAt: string
    /** When the team's review target runs out; null when the team has none. */
    dueAt: string | null
    /** Milliseconds past `dueAt`; 0 when on time, snoozed or without a target. */
    overdueByMs: number
    snoozedUntil: string | null
    snoozeKind: SnoozeKind | null
    /** When the request closed; null while it is open. */
    closedAt: string | null
    /** The reviewer's own last decision on the build; null while open or when someone else decided. */
    decision: 'approved' | 'rejected' | null
    reason: Reason | null
    /** The build this one was compared with; null when it had no baseline. */
    baseline: { number: number; branch: string | null } | null
    reviewer: { id: string; name: string; image: string | null }
    /** Null when whoever asked has since left. */
    requestedBy: { id: string; name: string; image: string | null } | null
    build: {
      number: number
      /** The build's name; "default" for a team's only build per commit. */
      name: string
      branch: string | null
      prNumber: number | null
      commitSha: string
      status: BuildStatus
      conclusion: BuildConclusion | null
      reviewStatus: ReviewStatus
    }
    team: { slug: string; name: string }
    workspace: { slug: string; name: string }
    /** How the build's screenshots compare with the baseline. */
    changes: { changed: number; added: number; removed: number; unchanged: number }
    /** The (up to two) changed screenshots with the highest diff score, biggest first. */
    largestChanges: {
      name: string
      /** Fraction of the screenshot that differs, 0 to 1; null when not measured. */
      score: number | null
      /** The head image and its thumbnail; null when the screenshot has no head image. */
      sha256: string | null
      thumbnail: string | null
    }[]
  }

  /** `GET /api/reviews?tab=…`: one tab of the Reviews page, most urgent first. */
  export interface List {
    tab: Tab
    requests: Request[]
  }

  /** `POST …/builds/:number/review-requests`: the request, new or already open. */
  export interface Requested {
    id: string
    state: ReviewRequestState
    dueAt: string | null
    /** False when the reviewer already had an open request for this build. */
    created: boolean
  }

  /** `POST …/builds/request-review`: one entry per build and reviewer. */
  export interface BulkRequested {
    requests: (Requested & { buildId: string; reviewerId: string })[]
  }
}
