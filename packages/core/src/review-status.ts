/**
 * A build's review status, derived from the decisions on its snapshots (PLAN §7.4): every
 * changed snapshot approved is `approved`; any rejected snapshot is `rejected`; otherwise the
 * build still `pending`. Unchanged snapshots need no decision, and a build with nothing changed
 * has nothing to approve.
 */
export function deriveReviewStatus(input: deriveReviewStatus.Input): deriveReviewStatus.Result {
  const decisions = input.decisions
  if (input.changed.some((name) => decisions.get(name) === 'rejected')) return 'rejected'
  if (
    input.changed.length > 0 &&
    input.changed.every((name) => decisions.get(name) === 'approved')
  ) {
    return 'approved'
  }
  return 'pending'
}

export namespace deriveReviewStatus {
  export interface Input {
    /** Names of the snapshots that differ from the baseline and so need a decision. */
    changed: readonly string[]
    /** Current decision per snapshot name; snapshots with none are absent. */
    decisions: ReadonlyMap<string, 'approved' | 'rejected'>
  }
  export type Result = 'pending' | 'approved' | 'rejected'
}
