import type { Build } from '@circi/api'
import type { Status } from '@circi/ui'

export interface BuildState {
  kind: BuildState.Kind
  label: string
  /** The design system's status for the glyph (docs/design-gaps.md §8). */
  status: Status
  tone: BuildState.Tone
}

export namespace BuildState {
  export type Input = Pick<Build.ListItem, 'status' | 'conclusion' | 'reviewStatus'>

  export type Kind =
    | 'uploading'
    | 'processing'
    | 'failed'
    | 'expired'
    | 'rejected'
    | 'no_changes'
    | 'approved'
    | 'review'

  /** The old colour vocabulary; kept so callers that still read `tone` keep working. Prefer `status`. */
  export type Tone = 'success' | 'attention' | 'danger' | 'rejected' | 'accent' | 'done' | 'neutral'

  /** What the review screen shows: a build state, or "No baseline" for an orphan. */
  export interface Screen {
    kind: Kind | 'orphan'
    label: string
    status: Status
  }
}

/** What to call a build, from its status, conclusion and review. Pure: no rendering. */
export function buildState(b: BuildState.Input): BuildState {
  if (b.status === 'uploading' || b.status === 'pending')
    return { kind: 'uploading', label: 'Uploading', status: 'processing', tone: 'neutral' }
  if (b.status === 'processing')
    return { kind: 'processing', label: 'Processing', status: 'processing', tone: 'neutral' }
  if (b.status === 'error')
    return { kind: 'failed', label: 'Failed', status: 'failed', tone: 'danger' }
  if (b.status === 'expired')
    return { kind: 'expired', label: 'Expired', status: 'neutral', tone: 'neutral' }
  if (b.reviewStatus === 'rejected')
    return { kind: 'rejected', label: 'Rejected', status: 'rejected', tone: 'rejected' }
  if (b.conclusion === 'no_changes')
    return { kind: 'no_changes', label: 'No changes', status: 'approved', tone: 'success' }
  if (b.reviewStatus === 'approved')
    return { kind: 'approved', label: 'Approved', status: 'approved', tone: 'done' }
  return { kind: 'review', label: 'Needs review', status: 'needs-review', tone: 'attention' }
}

/**
 * The state the review screen shows: `buildState`, except that a build with changes to review
 * but nothing to compare against (an orphan) is "No baseline" (docs/design-gaps.md §8).
 */
export function screenState(b: BuildState.Input, hasBaseline: boolean): BuildState.Screen {
  const state = buildState(b)
  if (state.kind === 'review' && !hasBaseline)
    return { kind: 'orphan', label: 'No baseline', status: 'neutral' }
  return state
}
