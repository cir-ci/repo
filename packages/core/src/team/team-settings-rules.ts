import { ValidationError } from '../errors.ts'

/**
 * The bounds and shapes of a team's settings, shared by the database layer (which enforces
 * them) and anyone who wants to say them out loud.
 */

/** Longest retention, in days (ten years). */
export const MAX_RETENTION_DAYS = 3650
/** Longest review target, in hours (thirty days). */
export const MAX_REVIEW_TARGET_HOURS = 720

/** Refuses a retention that is not a whole number of days from 1 to `MAX_RETENTION_DAYS`. */
export function assertRetentionDays(days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > MAX_RETENTION_DAYS) {
    throw new ValidationError(`Retention must be between 1 and ${MAX_RETENTION_DAYS} days`, {
      fields: { retentionDays: `Between 1 and ${MAX_RETENTION_DAYS} days` },
    })
  }
}

/** Refuses a review target that is not a whole number of hours from 1 to `MAX_REVIEW_TARGET_HOURS`. */
export function assertReviewTargetHours(hours: number): void {
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_REVIEW_TARGET_HOURS) {
    throw new ValidationError(
      `The review target must be between 1 and ${MAX_REVIEW_TARGET_HOURS} hours, or empty for none`,
      { fields: { reviewTargetHours: `Between 1 and ${MAX_REVIEW_TARGET_HOURS} hours, or empty` } },
    )
  }
}

/**
 * The diff threshold is stored, and taken by the API, as a share (0 to 1); the dashboard shows
 * it as a percentage and has its own message for that.
 */
export function assertDiffThreshold(share: number): void {
  if (!(share >= 0 && share <= 1)) {
    const message = 'The diff threshold must be between 0 and 1 (0.05 is 5%)'
    throw new ValidationError(message, { fields: { diffThreshold: message } })
  }
}

/**
 * What is wrong with a git branch name under git's ref rules (`git check-ref-format --branch`),
 * or undefined when it is fine.
 */
export function branchNameProblem(name: string): string | undefined {
  if (name === '') return 'A branch name is required'
  if (name === '@') return `A branch name can't be just "@"`
  if (name.startsWith('-')) return `A branch name can't start with "-"`
  if (name.startsWith('/') || name.endsWith('/')) {
    return `A branch name can't start or end with "/"`
  }
  if (name.endsWith('.')) return `A branch name can't end with "."`
  if (name.includes('..')) return `A branch name can't contain ".."`
  if (name.includes('//')) return `A branch name can't contain "//"`
  if (name.includes('@{')) return `A branch name can't contain "@{"`
  // oxlint-disable-next-line no-control-regex -- git forbids control characters
  if (/[\u0000- \u007f~^:?*[\\]/.test(name)) {
    return "A branch name can't contain spaces or any of ~ ^ : ? * [ \\"
  }
  for (const part of name.split('/')) {
    if (part.startsWith('.')) return `A part of a branch name can't start with "."`
    if (part.endsWith('.lock')) return `A part of a branch name can't end with ".lock"`
  }
  return undefined
}

/** Refuses a name git would not accept for a branch. */
export function assertBranchName(name: string): void {
  const problem = branchNameProblem(name)
  if (problem) {
    throw new ValidationError(problem, { fields: { defaultBranch: problem } })
  }
}
