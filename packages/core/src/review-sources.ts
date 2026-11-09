/** Where a review decision came from: the dashboard, a git host, or CirCI itself. */
export const REVIEW_SOURCES = [
  'ui',
  'github-check',
  'github-comment',
  'gitlab-comment',
  'gitlab-status',
  'bitbucket-comment',
  'bitbucket-status',
  'auto',
  'rerun',
] as const
export type ReviewSource = (typeof REVIEW_SOURCES)[number]
