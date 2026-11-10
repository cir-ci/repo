import type { Insights } from '@circi/api'

export const web: Insights.TeamRef = { slug: 'web', name: 'Web', colour: 'slate', icon: null }
export const docs: Insights.TeamRef = { slug: 'docs', name: 'Docs', colour: 'moss', icon: null }

export const summary = (over: Partial<Insights.Summary> = {}): Insights.Summary => ({
  medianReviewHours: 3.4,
  p90ReviewHours: 11,
  buildsReviewed: 186,
  reviewedOverTarget: 4,
  reviewedWithTarget: 186,
  buildsFinished: 400,
  buildsWithChanges: 92,
  changeRate: 0.23,
  medianDecisionHours: 7.8,
  p90DecisionHours: 22,
  buildsDecided: 150,
  failedBuilds: 31,
  ...over,
})

const none: Insights.Outcomes = { approved: 0, autoApproved: 0, rejected: 0, failed: 0 }

export const week = (weekStart: string, over: Partial<Insights.Week> = {}): Insights.Week => ({
  weekStart,
  medianReviewHours: 3,
  reviews: 30,
  flaky: 7,
  medianDecisionHours: 7.9,
  p90DecisionHours: 22,
  decided: 52,
  outcomes: { approved: 44, autoApproved: 59, rejected: 5, failed: 4 },
  failedBuilds: 4,
  medianProcessingMinutes: 2.6,
  p90ProcessingMinutes: 6.6,
  ...over,
})

export const emptyWeek = (weekStart: string): Insights.Week =>
  week(weekStart, {
    medianReviewHours: null,
    reviews: 0,
    flaky: 0,
    medianDecisionHours: null,
    p90DecisionHours: null,
    decided: 0,
    outcomes: none,
    failedBuilds: 0,
    medianProcessingMinutes: null,
    p90ProcessingMinutes: null,
  })

/** A report with data in every section: two teams, so every card shows. */
export const fullReport = (over: Partial<Insights.Report> = {}): Insights.Report => ({
  workspace: { slug: 'acme', name: 'Acme' },
  team: null,
  range: { from: '2026-10-09T00:00:00.000Z', to: '2026-11-08T00:00:00.000Z' },
  summary: summary(),
  previous: summary({
    medianReviewHours: 6.1,
    buildsReviewed: 166,
    reviewedOverTarget: 8,
    reviewedWithTarget: 166,
    failedBuilds: 22,
    medianDecisionHours: 9,
    buildsDecided: 120,
  }),
  bucket: 'week',
  weeks: [
    week('2026-10-26T00:00:00.000Z', { medianReviewHours: 5, reviews: 20, flaky: 12 }),
    week('2026-11-02T00:00:00.000Z'),
  ],
  storage: {
    totalBytes: 3 * 1024 ** 3,
    teams: [
      { ...web, bytes: 2 * 1024 ** 3 },
      { ...docs, bytes: 1024 ** 3 },
    ],
  },
  reviewers: [
    {
      id: 'u1',
      name: 'Ada Lovelace',
      image: null,
      openRequests: 2,
      overdue: 1,
      reviews: 40,
      medianResponseHours: 2.5,
    },
  ],
  reviewTargetHours: 4,
  retentionDays: { min: 90, max: 90 },
  flakyAfterChanges: 3,
  backlog: [
    { day: '2026-11-06T00:00:00.000Z', waiting: 3 },
    { day: '2026-11-07T00:00:00.000Z', waiting: 6 },
  ],
  waitingNow: 6,
  oldestWaiting: [
    {
      buildId: 'b418',
      number: 418,
      team: web,
      branch: 'feature/checkout-redesign',
      author: 'Omer Katz',
      readyAt: '2026-11-05T14:00:00.000Z',
      overTarget: true,
    },
    {
      buildId: 'b420',
      number: 420,
      team: docs,
      branch: 'main',
      author: null,
      readyAt: '2026-11-07T23:00:00.000Z',
      overTarget: false,
    },
  ],
  mostChanged: [
    {
      team: web,
      name: 'checkout/summary',
      changedBuilds: 14,
      builds: 62,
      last10: [false, false, true, false, false, true, true, false, true, true],
    },
  ],
  flakiest: [
    {
      team: docs,
      name: 'home/hero',
      changedBuilds: 6,
      builds: 10,
      last10: [true, false, true, true, false, true, false, true, false, true],
    },
  ],
  rejections: {
    rejectedBuilds: 53,
    withReason: 38,
    recent: [
      {
        buildId: 'b418',
        number: 418,
        team: web,
        reviewer: 'Omer Katz',
        reason: 'The button moved 4px, please restore the spacing.',
        at: '2026-11-06T10:00:00.000Z',
      },
    ],
  },
  mostRejected: [
    { team: web, name: 'checkout/summary', rejections: 5 },
    { team: docs, name: 'home/hero', rejections: 1 },
  ],
  teamsComparison: [
    {
      team: web,
      builds: 700,
      buildsWithChanges: 182,
      medianReviewHours: 5,
      reviewTargetHours: 4,
      flaky: 3,
      failed: 20,
    },
    {
      team: docs,
      builds: 300,
      buildsWithChanges: 30,
      medianReviewHours: 2,
      reviewTargetHours: 4,
      flaky: 0,
      failed: 11,
    },
  ],
  failureReasons: [
    { message: 'Timed out waiting for shards', builds: 12 },
    { message: "A screenshot file isn't a valid image", builds: 4 },
  ],
  ignoreRegions: {
    suppressedDiffs: 142,
    top: [
      { team: web, region: 'header/clock', diffs: 90 },
      { team: docs, region: 'footer/year', diffs: 52 },
    ],
  },
  ...over,
})
