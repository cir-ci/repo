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
 * (docs/design-gaps.md §8): a changed, added or removed screenshot follows the review of its
 * build, pending is `needs-review`, approved (by a person or automatically) is `approved`,
 * rejected is `rejected`. Unchanged and flaky stay `neutral`; failed stays `rejected`
 * whatever the review.
 */
export function screenshotStatus(kind: ShotKind, review: ReviewStatus): Status {
  switch (kind) {
    case 'changed':
    case 'added':
    case 'removed':
      return review === 'pending' ? 'needs-review' : review
    case 'failed':
      return 'rejected'
    case 'unchanged':
    case 'flaky':
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
  const decided = screenshotStatus(kind, review) !== 'needs-review' && review !== 'pending'
  const suffix = decided && (kind === 'changed' || kind === 'added' || kind === 'removed')
  return suffix ? `${DIFF_LABEL[kind]}, ${review}` : DIFF_LABEL[kind]
}
