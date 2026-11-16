import type { Build, ReviewState } from '@circi/api'
import { deriveReviewStatus } from '@circi/core'

/** Whether a screenshot differs from the baseline, so it takes a decision (same rule as `needsDecision`). */
const takesDecision = (d: Pick<Build.DiffItem, 'status'>) =>
  d.status !== null && d.status !== 'unchanged' && d.status !== 'failed'

/**
 * The build as it looks once these screenshots are decided: each carries the decision (by whom,
 * and now), and the build's review status follows from all of them the way the server derives it.
 * `names` is `'undecided'` for every changed screenshot still without one.
 */
export function withSnapshotDecisions(
  detail: Build.Detail,
  names: readonly string[] | 'undecided',
  decision: ReviewState,
  reason: string | null,
  reviewer: { id: string; name: string } | null,
  now: Date,
): Build.Detail {
  const whole = detail.build.reviewStatus
  const undecided = (d: Build.DiffItem) => !d.review && whole !== 'approved'
  const chosen = (d: Build.DiffItem) =>
    takesDecision(d) && (names === 'undecided' ? undecided(d) : names.includes(d.name))
  const diffs = detail.diffs.map((d) =>
    chosen(d)
      ? { ...d, review: { decision, reviewer, at: now.toISOString(), reason: reason ?? null } }
      : d,
  )
  const decisions = new Map<string, ReviewState>()
  for (const d of diffs) {
    const current = d.review?.decision ?? (whole === 'approved' ? 'approved' : undefined)
    if (current) decisions.set(d.name, current)
  }
  const reviewStatus = deriveReviewStatus({
    changed: diffs.filter(takesDecision).map((d) => d.name),
    decisions,
  })
  return { ...detail, diffs, build: { ...detail.build, reviewStatus } }
}

/** The build as approved or rejected as a whole. */
export function withBuildDecision(detail: Build.Detail, state: ReviewState): Build.Detail {
  return { ...detail, build: { ...detail.build, reviewStatus: state } }
}
