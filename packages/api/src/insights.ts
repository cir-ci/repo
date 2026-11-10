export namespace Insights {
  /** What the headline numbers say about one stretch of time. */
  export interface Summary {
    /** Hours from a build being ready to its first review; null when nothing was reviewed. */
    medianReviewHours: number | null
    p90ReviewHours: number | null
    /** Builds whose first review (by a person) fell in the range. */
    buildsReviewed: number
    /** Of those, how many waited longer than their team's review target. */
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
    /** Bytes of distinct stored files each team's builds refer to. */
    teams: { slug: string; name: string; bytes: number }[]
    totalBytes: number
  }

  export interface Reviewer {
    id: string
    name: string
    image: string | null
    /** Requests waiting on them now. */
    openRequests: number
    /** Open requests past their due time now, plus ones they closed late in the range. */
    overdue: number
    /** Decisions they recorded in the range. */
    reviews: number
    /** Median hours from request to completion, for requests they completed in the range. */
    medianResponseHours: number | null
  }

  /** `GET /api/workspaces/:workspace/insights?team=&from=&to=`. */
  export interface Report {
    workspace: { slug: string; name: string }
    /** The team slug when narrowed to one; null for the whole workspace. */
    team: string | null
    range: { from: string; to: string }
    summary: Summary
    /** The same numbers for the stretch of equal length just before `range`. */
    previous: Summary
    weeks: Week[]
    storage: Storage
    reviewers: Reviewer[]
    /** The review target the scope shares, in hours; null when there is none or teams differ. */
    reviewTargetHours: number | null
    /** Days of branch builds retention keeps: the shortest and longest of the scope's teams. */
    retentionDays: { min: number; max: number } | null
    /** Changes before a screenshot counts as flaky, when every team in the scope agrees. */
    flakyAfterChanges: number | null
  }
}
