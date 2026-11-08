export namespace Search {
  export interface Build {
    projectSlug: string
    projectName: string
    number: number
    name: string
    branch: string | null
    prNumber: number | null
    status: 'pending' | 'uploading' | 'processing' | 'complete' | 'error' | 'expired'
    reviewStatus: 'pending' | 'approved' | 'rejected'
  }

  export interface Branch {
    projectSlug: string
    projectName: string
    branch: string
    latestBuildNumber: number
  }

  export interface Project {
    slug: string
    name: string
  }

  export interface Snapshot {
    projectSlug: string
    projectName: string
    name: string
    latestBuildNumber: number
  }

  /** `GET /api/orgs/:org/search?q=`: matches grouped, each group limited. */
  export interface Results {
    query: string
    builds: Build[]
    branches: Branch[]
    projects: Project[]
    snapshots: Snapshot[]
  }
}
