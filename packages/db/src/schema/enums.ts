/**
 * Allowed values for status-like columns. They're `text` + CHECK rather than Postgres enums:
 * adding a value is then a plain constraint swap instead of an `ALTER TYPE` that can't run
 * inside a transaction.
 */

// Lists the core rules also need live in `@circi/core`; the CHECK constraints use the same values.
export {
  REVIEW_SOURCES,
  SNOOZE_KINDS,
  TRIAGE_KINDS,
  type ReviewSource,
  type SnoozeKind,
  type TriageKind,
} from '@circi/core'
export { WEBHOOK_EVENTS, type WebhookEvent } from '@circi/core/node'

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
/** Where a review request stands: waiting on the reviewer, or closed for one of three reasons. */
export const REVIEW_REQUEST_STATES = ['open', 'done', 'superseded', 'dismissed'] as const
/** What a review rule's pattern is matched against. */
export const REVIEW_RULE_KINDS = ['snapshot-name', 'build-name'] as const
/** What an inbox notification is about. */
export const NOTIFICATION_KINDS = [
  'review_requested',
  'review_re_requested',
  'mentioned',
  'build_approved',
  'build_rejected',
  'review_overdue',
  'connection_needs_attention',
  'flaky_detected',
] as const
/**
 * How someone signed in: `oidc` is an instance-wide single sign-on provider, `workspace-oidc` one an
 * workspace added itself (and which only opens that workspace).
 */
export const LOGIN_METHODS = ['password', 'email', 'oidc', 'workspace-oidc'] as const
/**
 * Git hosts a connection can be to. GitLab and Bitbucket are added here (a CHECK swap in a
 * migration, no data change) by the work that implements their providers.
 */
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
export type ReviewRequestState = (typeof REVIEW_REQUEST_STATES)[number]
export type ReviewRuleKind = (typeof REVIEW_RULE_KINDS)[number]
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]
export type JobStatus = (typeof JOB_STATUSES)[number]
