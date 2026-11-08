import type { Build } from '@circi/api'
import type { Status } from '@circi/ui'

export type BuildStatus = Pick<Build.ListItem, 'status' | 'conclusion' | 'reviewStatus'>

export type BuildStateKind =
  | 'uploading'
  | 'processing'
  | 'failed'
  | 'expired'
  | 'rejected'
  | 'no_changes'
  | 'approved'
  | 'review'

/** The old colour vocabulary; kept so callers that still read `tone` keep working. Prefer `status`. */
export type Tone = 'success' | 'attention' | 'danger' | 'accent' | 'done' | 'neutral'

export interface BuildState {
  kind: BuildStateKind
  label: string
  /** The design system's status for the glyph (docs/design-gaps.md §8). */
  status: Status
  tone: Tone
}

/** What to call a build, from its status, conclusion and review. Pure: no rendering. */
export function buildState(b: BuildStatus): BuildState {
  if (b.status === 'uploading' || b.status === 'pending')
    return { kind: 'uploading', label: 'Uploading', status: 'processing', tone: 'neutral' }
  if (b.status === 'processing')
    return { kind: 'processing', label: 'Processing', status: 'processing', tone: 'neutral' }
  if (b.status === 'error')
    return { kind: 'failed', label: 'Failed', status: 'rejected', tone: 'danger' }
  if (b.status === 'expired')
    return { kind: 'expired', label: 'Expired', status: 'neutral', tone: 'neutral' }
  if (b.reviewStatus === 'rejected')
    return { kind: 'rejected', label: 'Rejected', status: 'rejected', tone: 'danger' }
  if (b.conclusion === 'no_changes')
    return { kind: 'no_changes', label: 'No changes', status: 'approved', tone: 'success' }
  if (b.reviewStatus === 'approved')
    return { kind: 'approved', label: 'Approved', status: 'approved', tone: 'done' }
  return { kind: 'review', label: 'Needs review', status: 'needs-review', tone: 'attention' }
}

export interface ScreenState {
  kind: BuildStateKind | 'orphan'
  label: string
  status: Status
}

/**
 * The state the review screen shows: `buildState`, except that a build with changes to review
 * but nothing to compare against (an orphan) is "No baseline" (docs/design-gaps.md §8).
 */
export function screenState(b: BuildStatus, hasBaseline: boolean): ScreenState {
  const state = buildState(b)
  if (state.kind === 'review' && !hasBaseline)
    return { kind: 'orphan', label: 'No baseline', status: 'neutral' }
  return state
}
