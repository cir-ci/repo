import type { Flaky } from './flaky.ts'

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
    /** Of the reviewed builds, how many belong to a project with a review target. */
    reviewedWithTarget: number
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

  /** A project as the lists and charts name it: `colour` is its identity colour (`--circi-project-*`). */
  export interface ProjectRef {
    slug: string
    name: string
    colour: string
    /** The project's icon name (Lucide), for its avatar; null shows only the marble. */
    icon: string | null
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
    project: ProjectRef
    name: string
    changedBuilds: number
    builds: number
    last10: boolean[]
  }

  /** A flaky screenshot: `last10` is oldest first, true where that commit's image differs from the one before. */
  export interface FlakyScreenshot {
    project: ProjectRef
    name: string
    /** Times a commit's image came back to one it already had in the last 10 default-branch commits. */
    flipFlops: number
    /** Why it is flaky, with the evidence. */
    reason: Flaky.Reason
    last10: boolean[]
  }

  export interface WaitingBuild {
    buildId: string
    number: number
    project: ProjectRef
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
      project: ProjectRef
      reviewer: string | null
      reason: string
      at: string
    }[]
  }

  export interface ProjectComparison {
    project: ProjectRef
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
    top: { project: ProjectRef; region: string; diffs: number }[]
  }

  export interface Storage {
    /** Bytes of distinct stored files each project's builds refer to. */
    projects: { slug: string; name: string; colour: string; icon: string | null; bytes: number }[]
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

  /** `GET /api/workspaces/:workspace/insights?project=&from=&to=`. */
  export interface Report {
    workspace: { slug: string; name: string }
    /** The project slug when narrowed to one; null for the whole workspace. */
    project: string | null
    range: { from: string; to: string }
    summary: Summary
    /** The same numbers for the stretch of equal length just before `range`. */
    previous: Summary
    /** Whether `weeks` holds one entry per day (ranges of 7 days or less) or per week. */
    bucket: 'day' | 'week'
    weeks: Week[]
    storage: Storage
    reviewers: Reviewer[]
    /** The review target the scope shares, in hours; null when there is none or projects differ. */
    reviewTargetHours: number | null
    /** Days of branch builds retention keeps: the shortest and longest of the scope's projects. */
    retentionDays: { min: number; max: number } | null
    /** Flip-flops before a screenshot counts as flaky, when every project in the scope agrees. */
    flakyAfterChanges: number | null
    /** Builds waiting for a review at the end of each day of the range. */
    backlog: { day: string; waiting: number }[]
    waitingNow: number
    /** The five that have waited longest. */
    oldestWaiting: WaitingBuild[]
    mostChanged: ScreenshotChange[]
    flakiest: FlakyScreenshot[]
    rejections: Rejections
    mostRejected: { project: ProjectRef; name: string; rejections: number }[]
    /** One row per project in view; empty when narrowed to one project. */
    projectsComparison: ProjectComparison[]
    /** The five most common messages of failed builds. */
    failureReasons: { message: string; builds: number }[]
    /** Null when no project in view has an ignore region. */
    ignoreRegions: IgnoreRegionsEffect | null
  }
}
