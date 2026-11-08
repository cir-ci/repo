import type { Figma } from './figma.ts'
import type { Team } from './team.ts'

export type BuildStatus = 'pending' | 'uploading' | 'processing' | 'complete' | 'error' | 'expired'
export type BuildConclusion = 'no_changes' | 'changes_detected'
export type ReviewStatus = 'pending' | 'approved' | 'rejected'
export type ReviewState = 'approved' | 'rejected'
export type ReviewSource =
  | 'ui'
  | 'github-check'
  | 'github-comment'
  | 'gitlab-comment'
  | 'gitlab-status'
  | 'bitbucket-comment'
  | 'bitbucket-status'
  | 'auto'
  | 'rerun'
export type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged' | 'failed'

export namespace Build {
  /** Who made the change. `login` comes from the CI or the git host; the rest from a matched member. */
  export interface Author {
    login: string
    name: string | null
    avatarUrl: string | null
  }

  export interface Counts {
    added: number
    removed: number
    changed: number
    unchanged: number
    failed: number
    total: number
  }

  export interface ListItem {
    id: string
    number: number
    name: string
    commitSha: string
    branch: string | null
    prNumber: number | null
    status: BuildStatus
    conclusion: BuildConclusion | null
    reviewStatus: ReviewStatus
    createdAt: string
    counts: Counts
    author: Author | null
  }

  export interface ImageRef {
    sha256: string
    width: number | null
    height: number | null
  }

  export interface DiffItem {
    id: string
    name: string
    status: DiffStatus | null
    score: number | null
    changedPixels: number | null
    sizeChanged: boolean
    errorMessage: string | null
    head: (ImageRef & { thumbnail: string | null; metadata: Record<string, unknown> }) | null
    base: (ImageRef & { thumbnail: string | null }) | null
    diff: ImageRef | null
    /** The Figma frame this snapshot is linked to; absent or null when there is none. */
    figma?: Figma.Frame | null
  }

  /** One approve/reject decision. */
  export interface Review {
    state: ReviewState
    source: ReviewSource
    /** Why it was rejected, when the reviewer said. */
    reason: string | null
    /** Null for automatic approvals. */
    userName: string | null
    createdAt: string
  }

  export interface Detail {
    team: Team.Info
    build: ListItem & {
      baseBranch: string | null
      ancestryStatus: 'ok' | 'missing' | 'truncated'
      baselineSource: 'cli' | 'sdk' | 'provider' | 'fallback' | 'none' | null
      errorMessage: string | null
      completedAt: string | null
    }
    baseline: { number: number; commitSha: string; branch: string | null } | null
    /** Decisions, newest first. */
    reviews: Review[]
    diffs: DiffItem[]
    /** Issues created from the build in Linear or Jira, oldest first. */
    issues: { key: string; url: string; title: string }[]
  }
}
