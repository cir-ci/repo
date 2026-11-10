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
    /**
     * Hours from a build being ready to its last decision by a person (approved or rejected);
     * null when nothing was decided. Counts decisions on the whole build.
     */
    medianDecisionHours: number | null
    p90DecisionHours: number | null
    /** Builds whose last decision (by a person) fell in the range. */
    buildsDecided: number
    /** Builds that ended in `error` in the range. */
    failedBuilds: number
  }

  /** A team as the lists and charts name it: `colour` is its identity colour (`--circi-team-*`). */
  export interface TeamRef {
    slug: string
    name: string
    colour: string
  }

  /** One week (Monday to Sunday, UTC) of the charts; one day when `Report.bucket` is `day`. */
  export interface Week {
    /** The Monday (or the day), as an ISO date-time. */
    weekStart: string
    medianReviewHours: number | null
    reviews: number
    /** Flaky screenshots across the scope at the end of the week (or of the range). */
    flaky: number
    medianDecisionHours: number | null
    p90DecisionHours: number | null
    /** Builds whose last decision fell in the week. */
    decided: number
    /** Finished builds by ready week, one outcome each; builds still waiting are not counted. */
    outcomes: Outcomes
    failedBuilds: number
    /** Minutes from finalizing to completing, for finished builds that did not fail. */
    medianProcessingMinutes: number | null
    p90ProcessingMinutes: number | null
  }

  export interface Outcomes {
    approved: number
    autoApproved: number
    rejected: number
    failed: number
  }

  /** A screenshot and how often it changed: `last10` is oldest first, true for a change. */
  export interface ScreenshotChange {
    team: TeamRef
    name: string
    changedBuilds: number
    builds: number
    last10: boolean[]
  }

  export interface WaitingBuild {
    buildId: string
    number: number
    team: TeamRef
    branch: string | null
    author: string | null
    readyAt: string
    overTarget: boolean
  }

  export interface Rejections {
    /** Builds rejected in the range, and how many carry a reason. */
    rejectedBuilds: number
    withReason: number
    /** The latest reasons, one per build. */
    recent: {
      buildId: string
      number: number
      team: TeamRef
      reviewer: string | null
      reason: string
      at: string
    }[]
  }

  export interface TeamComparison {
    team: TeamRef
    builds: number
    buildsWithChanges: number
    medianReviewHours: number | null
    reviewTargetHours: number | null
    /** Flaky screenshots now. */
    flaky: number
    failed: number
  }

  export interface IgnoreRegionsEffect {
    /** Diffs the ignore regions kept unchanged in the range. */
    suppressedDiffs: number
    top: { team: TeamRef; region: string; diffs: number }[]
  }

  export interface Storage {
    /** Bytes of distinct stored files each team's builds refer to. */
    teams: { slug: string; name: string; colour: string; bytes: number }[]
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
    /** Whether `weeks` holds one entry per day (ranges of 7 days or less) or per week. */
    bucket: 'day' | 'week'
    weeks: Week[]
    storage: Storage
    reviewers: Reviewer[]
    /** The review target the scope shares, in hours; null when there is none or teams differ. */
    reviewTargetHours: number | null
    /** Days of branch builds retention keeps: the shortest and longest of the scope's teams. */
    retentionDays: { min: number; max: number } | null
    /** Flip-flops before a screenshot counts as flaky, when every team in the scope agrees. */
    flakyAfterChanges: number | null
    /** Builds waiting for a review at the end of each day of the range. */
    backlog: { day: string; waiting: number }[]
    waitingNow: number
    /** The five that have waited longest. */
    oldestWaiting: WaitingBuild[]
    mostChanged: ScreenshotChange[]
    flakiest: ScreenshotChange[]
    rejections: Rejections
    mostRejected: { team: TeamRef; name: string; rejections: number }[]
    /** One row per team in view; empty when narrowed to one team. */
    teamsComparison: TeamComparison[]
    /** The five most common messages of failed builds. */
    failureReasons: { message: string; builds: number }[]
    /** Null when no team in view has an ignore region. */
    ignoreRegions: IgnoreRegionsEffect | null
  }
}
