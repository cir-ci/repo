export namespace Insights {
  /** What the headline numbers say about one stretch of time. */
  export interface Summary {
    /** Hours from a build being ready to its first review; null when nothing was reviewed. */
    medianReviewHours: number | null
    p90ReviewHours: number | null
    /** Builds whose first review (by a person) fell in the range. */
    buildsReviewed: number
    /** Of those, how many waited longer than their project's review target. */
    reviewedOverTarget: number
    /** Finished builds in the range, and how many of them had changes. */
    buildsFinished: number
    buildsWithChanges: number
    /** `buildsWithChanges / buildsFinished` (0 to 1); null without finished builds. */
    changeRate: number | null
  }

  /** One week (Monday to Sunday, UTC) of the charts. */
  export interface Week {
    /** The Monday, as an ISO date-time. */
    weekStart: string
    medianReviewHours: number | null
    reviews: number
    /** Flaky screenshots across the scope at the end of the week (or of the range). */
    flaky: number
  }

  export interface Storage {
    /** Bytes of distinct stored files each project's builds refer to. */
    projects: { slug: string; name: string; bytes: number }[]
    totalBytes: number
  }

  export interface Reviewer {
    id: string
    name: string
    /** Requests waiting on them now. */
    openRequests: number
    /** Open requests past their due time now, plus ones they closed late in the range. */
    overdue: number
    /** Decisions they recorded in the range. */
    reviews: number
    /** Median hours from request to completion, for requests they completed in the range. */
    medianResponseHours: number | null
  }

  /** `GET /api/orgs/:org/insights?project=&from=&to=`. */
  export interface Report {
    org: { slug: string; name: string }
    /** The project slug when narrowed to one; null for the whole organization. */
    project: string | null
    range: { from: string; to: string }
    summary: Summary
    /** The same numbers for the stretch of equal length just before `range`. */
    previous: Summary
    weeks: Week[]
    storage: Storage
    reviewers: Reviewer[]
  }
}
