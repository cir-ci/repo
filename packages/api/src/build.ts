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

export namespace Snapshot {
  /** One build in a snapshot's history. */
  export interface HistoryEntry {
    build: {
      number: number
      branch: string | null
      status: BuildStatus
      reviewStatus: ReviewStatus
      createdAt: string
    }
    /** How the snapshot compared in that build; null while it is not compared yet. */
    status: DiffStatus | null
    /** The screenshot in that build (the baseline's for a removed one); null when there is none. */
    image: (Build.ImageRef & { thumbnail: string | null }) | null
  }

  /** `GET …/snapshots/:name/history?limit=5&branch=…`. */
  export interface History {
    defaultBranch: string
    /** Newest first. */
    default: HistoryEntry[]
    /** The viewed branch's builds; null when none was asked for or it is the default branch. */
    branch: HistoryEntry[] | null
  }
}

export namespace WorkspaceBuilds {
  /** A build in the workspace-wide list: the usual item, and the team it belongs to. */
  export interface Item extends Build.ListItem {
    team: { slug: string; name: string }
  }

  /** `GET /api/workspaces/:workspace/builds`: a page, newest first. */
  export interface List {
    workspace: { slug: string; name: string }
    builds: Item[]
    /** The cursor (`before`) of the next page; null on the last one. */
    next: string | null
  }

  /** One suggestion for the author or reviewer chip. */
  export interface Suggestion {
    /** What the filter takes: a user id, or (for unmatched authors) a git login. */
    value: string
    label: string
    kind: 'member' | 'login'
  }

  /** `GET /api/workspaces/:workspace/builds/suggestions?field=&q=`. */
  export interface Suggestions {
    suggestions: Suggestion[]
  }
}
