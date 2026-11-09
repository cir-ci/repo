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
            warning: `Build ${b.status === 'error' ? 'failed to process' : 'expired'}; merges are not blocked for this team`,
          }
    case 'complete':
      break
    default:
      return { state: 'fail', summary: `Unknown build status "${b.status}"` }
  }

  if (b.reviewStatus === 'rejected') return { state: 'fail', summary: 'Changes rejected' }
  if (b.conclusion === 'no_changes') return { state: 'pass', summary: 'No visual changes' }
  if (b.reviewStatus === 'approved') return { state: 'pass', summary: 'Changes approved' }
  if (b.flakyOnly && !b.flakyBlocksMerge) {
    return { state: 'pass', summary: 'Only flaky screenshots changed' }
  }
  return b.blockMergeOnChanges
    ? { state: 'fail', summary: 'Visual changes need review' }
    : {
        state: 'pass',
        summary: 'Visual changes to review',
        warning: 'Changes are not reviewed yet; merges are not blocked for this team',
      }
}

export namespace buildOutcome {
  export interface Input {
    status: string
    conclusion: string | null
    reviewStatus: string
    blockMergeOnChanges: boolean
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
