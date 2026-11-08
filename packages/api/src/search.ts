export namespace Search {
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

  /** `GET /api/workspaces/:workspace/search?q=`: matches grouped, each group limited. */
  export interface Results {
    query: string
    builds: Build[]
    branches: Branch[]
    teams: Team[]
    snapshots: Snapshot[]
  }
}
