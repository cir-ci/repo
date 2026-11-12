/**
 * Which builds a person can approve or reject: the one rule behind `/circi approve|reject` in a
 * pull request comment and the Approve and Reject buttons on a check, so the two can't differ.
 *
 * - `reviewable`: a finished build with changes, or (in a project that doesn't pass no-change
 *   builds on its own) a finished build with none, whose decision is the build's.
 * - `processing`: the build hasn't finished yet.
 * - `failed`: the build errored or expired, so there is nothing to decide.
 * - `nothing_to_review`: finished with no changes, and nothing is asked of anyone.
 */
export function reviewability(
  build: { status: string; conclusion: string | null },
  project: { autoApproveNoChanges: boolean },
): reviewability.Verdict {
  switch (build.status) {
    case 'pending':
    case 'uploading':
    case 'processing':
      return 'processing'
    case 'complete':
      break
    default:
      return 'failed'
  }
  if (build.conclusion === 'changes_detected') return 'reviewable'
  if (build.conclusion === 'no_changes' && !project.autoApproveNoChanges) return 'reviewable'
  return 'nothing_to_review'
}

export namespace reviewability {
  export type Verdict = 'reviewable' | 'processing' | 'failed' | 'nothing_to_review'
}
