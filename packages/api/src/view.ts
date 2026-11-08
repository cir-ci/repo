export namespace View {
  /**
   * The filters of a builds list: the query parameters of `GET /api/projects/:org/:project`
   * (`@circi/core`'s `BuildFilterValues` is the server-side twin; the contract check ties them).
   */
  export interface Filters {
    status?: 'pending' | 'uploading' | 'processing' | 'complete' | 'error' | 'expired'
    review?: 'pending' | 'approved' | 'rejected'
    branch?: string
    author?: string
    reviewer?: string
    name?: string
    /** ISO datetimes. */
    from?: string
    to?: string
  }

  /** A saved view of the signed-in user's, in an organization. */
  export interface Item {
    id: string
    name: string
    filters: Filters
    pinned: boolean
    position: number
    /** Null for a view across the whole organization. */
    project: { slug: string; name: string } | null
    createdAt: string
  }

  /** `GET /api/orgs/:org/views`. */
  export interface List {
    views: Item[]
  }

  /** `POST /api/orgs/:org/views`. */
  export interface CreateBody {
    name: string
    /** A project's slug; omit for a view across the organization. */
    project?: string
    filters: Filters
    pinned?: boolean
  }

  /** `PATCH /api/orgs/:org/views/:id`: any of these. */
  export interface UpdateBody {
    name?: string
    filters?: Filters
    pinned?: boolean
  }

  /** `PUT /api/orgs/:org/views/order`: every one of the user's views, in the new order. */
  export interface OrderBody {
    ids: string[]
  }
}
