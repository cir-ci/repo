/**
 * Allowed values for status-like columns. They're `text` + CHECK rather than Postgres enums:
 * adding a value is then a plain constraint swap instead of an `ALTER TYPE` that can't run
 * inside a transaction.
 */

export const FILE_KINDS = ['screenshot', 'diff', 'thumbnail', 'asset'] as const
export const FILE_STATUSES = ['pending', 'verified'] as const
export const BUILD_STATUSES = [
  'pending',
  'uploading',
  'processing',
  'complete',
  'error',
  'expired',
] as const
export const BUILD_CONCLUSIONS = ['no_changes', 'changes_detected'] as const
export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const
export const ANCESTRY_STATUSES = ['ok', 'missing', 'truncated'] as const
export const BASELINE_SOURCES = ['cli', 'sdk', 'provider', 'fallback', 'none'] as const
export const DIFF_STATUSES = ['added', 'removed', 'changed', 'unchanged', 'failed'] as const
export const DIFF_JOB_STATUSES = ['pending', 'running', 'done', 'failed'] as const
export const REVIEW_STATES = ['approved', 'rejected'] as const
export const REVIEW_SOURCES = ['ui', 'github-check', 'github-comment', 'auto', 'rerun'] as const
/** Where a review request stands: waiting on the reviewer, or closed for one of three reasons. */
export const REVIEW_REQUEST_STATES = ['open', 'done', 'superseded', 'dismissed'] as const
/** How a request was snoozed; `next_push` wakes on the next build of the branch (no end time). */
export const SNOOZE_KINDS = ['next_push', 'tomorrow', 'next_week', 'date'] as const
export const WEBHOOK_EVENTS = ['build.completed', 'build.reviewed'] as const
/**
 * How someone signed in: `oidc` is an instance-wide single sign-on provider, `org-oidc` one an
 * organization added itself (and which only opens that organization).
 */
export const LOGIN_METHODS = ['password', 'email', 'oidc', 'org-oidc'] as const
export const GIT_PROVIDER_KINDS = ['github'] as const
/** Why a git connection needs a person to look at it. */
export const CONNECTION_ATTENTION = ['installation_revoked'] as const
export const JOB_STATUSES = ['pending', 'running', 'done', 'failed'] as const

export type LoginMethod = (typeof LOGIN_METHODS)[number]
export type FileKind = (typeof FILE_KINDS)[number]
export type FileStatus = (typeof FILE_STATUSES)[number]
export type BuildStatus = (typeof BUILD_STATUSES)[number]
export type BuildConclusion = (typeof BUILD_CONCLUSIONS)[number]
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]
export type AncestryStatus = (typeof ANCESTRY_STATUSES)[number]
export type BaselineSource = (typeof BASELINE_SOURCES)[number]
export type DiffStatus = (typeof DIFF_STATUSES)[number]
export type DiffJobStatus = (typeof DIFF_JOB_STATUSES)[number]
export type ReviewState = (typeof REVIEW_STATES)[number]
export type ReviewSource = (typeof REVIEW_SOURCES)[number]
export type ReviewRequestState = (typeof REVIEW_REQUEST_STATES)[number]
export type SnoozeKind = (typeof SNOOZE_KINDS)[number]
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]
export type JobStatus = (typeof JOB_STATUSES)[number]
