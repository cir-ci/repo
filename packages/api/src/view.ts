export namespace View {
  /**
   * The filters of a builds list: the query parameters of `GET /api/teams/:workspace/:team`
   * (`@circi/core`'s `BuildFilterValues` is the server-side twin; the contract check ties them).
   */
  export interface Filters {
    status?: 'pending' | 'uploading' | 'processing' | 'complete' | 'error' | 'expired'
    review?: 'pending' | 'approved' | 'rejected'
    /** Exactly this branch. */
    branch?: string
    /** A branch whose name contains this text, in any case. */
    branchContains?: string
    /** Free text: a build number, PR number, commit prefix, build name, branch or author. */
    q?: string
    author?: string
    reviewer?: string
    name?: string
    /** ISO datetimes. */
    from?: string
    to?: string
  }

  /** A saved view of the signed-in user's, in a workspace. */
  export interface Item {
    id: string
    name: string
    filters: Filters
    pinned: boolean
    position: number
    /** Null for a view across the whole workspace. */
    team: { slug: string; name: string } | null
    createdAt: string
  }

  /** `GET /api/workspaces/:workspace/views`. */
  export interface List {
    views: Item[]
  }

  /** `POST /api/workspaces/:workspace/views`. */
  export interface CreateBody {
    name: string
    /** A team's slug; omit for a view across the workspace. */
    team?: string
    filters: Filters
    pinned?: boolean
  }

  /** `PATCH /api/workspaces/:workspace/views/:id`: any of these. */
  export interface UpdateBody {
    name?: string
    filters?: Filters
    pinned?: boolean
  }

  /** `PUT /api/workspaces/:workspace/views/order`: every one of the user's views, in the new order. */
  export interface OrderBody {
    ids: string[]
  }
}
