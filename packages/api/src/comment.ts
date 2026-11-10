import type { ReviewSource, ReviewState } from './build.ts'
import type { ReviewRequestState } from './review.ts'

export namespace Comment {
  /** A rectangle on a snapshot, as fractions (0 to 1) of its width and height. */
  export interface Region {
    x: number
    y: number
    width: number
    height: number
  }

  /** The two images of a snapshot a region can be drawn on. */
  export type RegionSide = 'baseline' | 'current'

  export interface Author {
    id: string
    name: string
  }

  export interface Item {
    id: string
    /** Set on a reply; replies are one level deep. */
    parentId: string | null
    snapshotName: string | null
    region: Region | null
    /** The image the region was drawn on; 'current' (this build) for a comment with no region. */
    regionSide: RegionSide
    /** Empty for a deleted comment, which stays so its thread keeps its shape. */
    body: string
    /** Null when the author has since left. */
    author: Author | null
    createdAt: string
    editedAt: string | null
    deletedAt: string | null
    /** The caller wrote it. */
    mine: boolean
    /** The caller may delete it: their own, or any as a workspace owner or admin. */
    canDelete: boolean
  }

  /** `GET …/builds/:number/comments`: oldest first. */
  export interface List {
    comments: Item[]
  }

  /** `POST …/builds/:number/comments`. */
  export interface Create {
    body: string
    snapshotName?: string
    region?: Region
    /** Which image the region is on; defaults to 'current'. */
    regionSide?: RegionSide
    /** Reply to this comment instead of starting a thread. */
    parentId?: string
  }

  /** `PATCH …/builds/:number/comments/:id`. */
  export interface Edit {
    body: string
  }
}

export namespace Activity {
  export interface Person {
    id: string
    name: string
  }

  interface Base {
    /** ISO time. */
    at: string
  }

  export type Event = Base &
    (
      | { type: 'uploaded' }
      | { type: 'processing' }
      | { type: 'completed' }
      | { type: 'failed'; message: string | null }
      | { type: 'check_created' }
      | { type: 'review_requested'; reviewer: Person | null; by: Person | null }
      | { type: 'review_request_closed'; reviewer: Person | null; state: ReviewRequestState }
      | {
          type: 'review'
          state: ReviewState
          source: ReviewSource
          reason: string | null
          by: Person | null
        }
      | {
          /** Decisions on snapshots, grouped when one action decided several (approve all). */
          type: 'snapshot_review'
          decision: ReviewState
          snapshotNames: string[]
          reason: string | null
          by: Person | null
        }
      | {
          type: 'comment'
          commentId: string
          parentId: string | null
          snapshotName: string | null
          body: string
          by: Person | null
        }
      | {
          type: 'issue_created'
          issue: { key: string; url: string; title: string; tracker: string }
          snapshotName: string | null
          by: Person | null
        }
    )

  /** `GET …/builds/:number/activity`: oldest first. */
  export interface Timeline {
    events: Event[]
  }
}
