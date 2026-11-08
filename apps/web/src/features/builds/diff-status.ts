import type { Build, DiffStatus, ReviewStatus } from '@circi/api'
import type { Status } from '@circi/ui'

/** A screenshot's kind: its diff status, plus "flaky" for one that keeps changing on the default branch. */
export type ShotKind = DiffStatus | 'flaky'

/** The word for each kind (docs/design-gaps.md §8). The glyph comes from `screenshotStatus`. */
export const DIFF_LABEL: Record<ShotKind, string> = {
  changed: 'Changed',
  added: 'Added',
  removed: 'Removed',
  failed: 'Failed',
  unchanged: 'Unchanged',
  flaky: 'Flaky',
}

/**
 * The glyph for a screenshot, or for a count chip of one kind. The one place this rule exists
 * (docs/design-gaps.md §8): a changed, added or removed screenshot is pending until its build
 * is reviewed (changed shows `needs-review`, added and removed their own ring-and-mark glyph),
 * then follows the decision: approved (by a person or automatically) is `approved`, rejected is
 * `rejected`. Flaky keeps its own glyph whatever the review, unchanged stays `neutral`, failed
 * stays `rejected`.
 */
export function screenshotStatus(kind: ShotKind, review: ReviewStatus): Status {
  switch (kind) {
    case 'changed':
      return review === 'pending' ? 'needs-review' : review
    case 'added':
    case 'removed':
      return review === 'pending' ? kind : review
    case 'flaky':
      return 'flaky'
    case 'failed':
      return 'rejected'
    case 'unchanged':
    default:
      return 'neutral'
  }
}

/**
 * The review a build's screenshots follow. Only a finished build has one to follow: expired and
 * processing builds show their screenshots as they were (pending).
 */
export const shotReview = (build: Pick<Build.ListItem, 'status' | 'reviewStatus'>): ReviewStatus =>
  build.status === 'complete' ? build.reviewStatus : 'pending'

/** What a glyph reads as to assistive tech: the kind, plus the decision when one has been made. */
export function screenshotLabel(kind: ShotKind, review: ReviewStatus): string {
  const suffix =
    review !== 'pending' && (kind === 'changed' || kind === 'added' || kind === 'removed')
  return suffix ? `${DIFF_LABEL[kind]}, ${review}` : DIFF_LABEL[kind]
}

/**
 * The decision a snapshot's glyph follows: its own when someone (or auto-approve) made one;
 * otherwise pending, except in a build that is approved as a whole (nothing left to decide).
 */
export const shotDecision = (
  diff: Pick<Build.DiffItem, 'review'>,
  build: ReviewStatus,
): ReviewStatus => diff.review?.decision ?? (build === 'approved' ? 'approved' : 'pending')
