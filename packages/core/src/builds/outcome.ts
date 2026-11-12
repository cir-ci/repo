/**
 * What a build means for a merge (PLAN §7.4 status table). Shared by `--wait` and, later, the
 * git host commit statuses, so the two can never disagree.
 */

export function buildOutcome(b: buildOutcome.Input): buildOutcome.Result {
  switch (b.status) {
    case 'pending':
    case 'uploading':
    case 'processing':
      return { state: 'pending', summary: `Build is ${b.status}` }
    case 'error':
    case 'expired':
      return b.blockMergeOnChanges
        ? {
            state: 'fail',
            summary: `Build ${b.status === 'error' ? 'failed to process' : 'expired'}`,
          }
        : {
            state: 'pass',
            summary: 'Build could not be checked',
            warning: `Build ${b.status === 'error' ? 'failed to process' : 'expired'}; merges aren't blocked for this project`,
          }
    case 'complete':
      break
    default:
      return { state: 'fail', summary: `Unknown build status "${b.status}"` }
  }

  // A screenshot the server couldn't read is an input problem no review can settle: whatever was
  // approved, it holds the build like a build that failed to process does, so it follows the
  // project's blocking setting: it fails a project that blocks merges, and passes with a warning
  // otherwise.
  const unreadable = b.unreadable ?? 0
  if (unreadable > 0) {
    const summary = `${unreadable} ${unreadable === 1 ? 'screenshot' : 'screenshots'} couldn't be read`
    return b.blockMergeOnChanges
      ? { state: 'fail', summary }
      : {
          state: 'pass',
          summary,
          warning: `${summary}; merges aren't blocked for this project`,
        }
  }
  if (b.reviewStatus === 'rejected') return { state: 'fail', summary: 'Changes rejected' }
  if (b.conclusion === 'no_changes') {
    if (b.autoApproveNoChanges === false && b.reviewStatus !== 'approved') {
      return b.blockMergeOnChanges
        ? { state: 'fail', summary: 'No visual changes; waiting for approval' }
        : {
            state: 'pass',
            summary: 'No visual changes',
            warning: "Not approved yet; merges aren't blocked for this project",
          }
    }
    return { state: 'pass', summary: 'No visual changes' }
  }
  if (b.reviewStatus === 'approved') return { state: 'pass', summary: 'Changes approved' }
  if (b.flakyOnly && !b.flakyBlocksMerge) {
    return { state: 'pass', summary: 'Only flaky screenshots changed' }
  }
  return b.blockMergeOnChanges
    ? { state: 'fail', summary: 'Visual changes need review' }
    : {
        state: 'pass',
        summary: 'Visual changes to review',
        warning: "Changes aren't reviewed yet; merges aren't blocked for this project",
      }
}

export namespace buildOutcome {
  export interface Input {
    status: string
    conclusion: string | null
    reviewStatus: string
    blockMergeOnChanges: boolean
    /** How many screenshots the server couldn't read (failed diffs); none when omitted. */
    unreadable?: number
    /** Whether a build with no changes passes on its own (default: it does). */
    autoApproveNoChanges?: boolean
    /** Every difference is a flaky screenshot (`onlyFlakyChanges`). */
    flakyOnly: boolean
    /** The effective setting (`resolveFlakyBlocksMerge`). */
    flakyBlocksMerge: boolean
  }

  export interface Result {
    /** `pending` while processing; `pass`/`fail` once there's an answer. */
    state: 'pending' | 'pass' | 'fail'
    /** One line for CLI output and commit status descriptions. */
    summary: string
    /** Passing, but something deserves a look (unreviewed changes when merges aren't blocked). */
    warning?: string
  }
}
