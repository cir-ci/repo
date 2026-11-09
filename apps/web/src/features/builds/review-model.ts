import type { Activity, Build, ReviewStatus } from '@circi/api'

import { shotDecision, type ShotKind } from './diff-status.ts'

/**
 * Review order (docs/design-gaps.md §7): what needs a decision first, then what doesn't. Only
 * what needs no attention starts collapsed.
 */
export const GROUP_ORDER: readonly { kind: ShotKind; title: string; open: boolean }[] = [
  { kind: 'changed', title: 'Changed', open: true },
  { kind: 'added', title: 'Added', open: true },
  { kind: 'removed', title: 'Removed', open: true },
  { kind: 'flaky', title: 'Flaky', open: false },
  { kind: 'failed', title: 'Failed', open: true },
  { kind: 'unchanged', title: 'Unchanged', open: false },
]

/** The group a screenshot belongs to. A changed screenshot known to be flaky goes with the flaky ones. */
export function shotKind(diff: Build.DiffItem, flaky: ReadonlySet<string>): ShotKind | undefined {
  if (diff.status === null) return undefined
  return diff.status === 'changed' && flaky.has(diff.name) ? 'flaky' : diff.status
}

export interface ShotGroup {
  kind: ShotKind
  title: string
  open: boolean
  items: Build.DiffItem[]
}

/** The non-empty groups in review order. Screenshots without a status yet are left out. */
export function groupShots(
  diffs: readonly Build.DiffItem[],
  flaky: ReadonlySet<string> = new Set(),
): ShotGroup[] {
  return GROUP_ORDER.flatMap((g) => {
    const items = diffs.filter((d) => shotKind(d, flaky) === g.kind)
    return items.length > 0 ? [{ ...g, items }] : []
  })
}

/** Every screenshot in the order the list shows them, which is the order j and k walk. */
export const orderShots = (groups: readonly ShotGroup[]): Build.DiffItem[] =>
  groups.flatMap((g) => g.items)

/** The screenshot to open when none is chosen: the first that needs attention, else the first. */
export function defaultShot(groups: readonly ShotGroup[]): Build.DiffItem | undefined {
  const attention = groups.find((g) => g.kind !== 'unchanged' && g.kind !== 'flaky')
  return attention?.items[0] ?? orderShots(groups)[0]
}

/** The screenshot one step away from `current`, stopping at either end. */
export function neighbour(
  ordered: readonly Build.DiffItem[],
  current: Build.DiffItem | undefined,
  step: 1 | -1,
): Build.DiffItem | undefined {
  if (ordered.length === 0) return undefined
  const at = current ? ordered.indexOf(current) : -1
  return ordered[Math.min(ordered.length - 1, Math.max(0, at + step))]
}

/** A share of changed pixels (0 to 1) as a percentage without the sign: "<0.01", "0.42", "12.5". */
export function formatPercent(score: number): string {
  const pct = score * 100
  return pct < 0.01 ? '<0.01' : pct.toFixed(pct < 1 ? 2 : 1)
}

/** The short figure at the right of a list row: a diff percentage, or "resized"; blank otherwise. */
export function shotBadge(diff: Pick<Build.DiffItem, 'status' | 'score' | 'sizeChanged'>): string {
  if (diff.status !== 'changed') return ''
  if (diff.sizeChanged) return 'resized'
  return diff.score === null ? '' : `${formatPercent(diff.score)}%`
}

/** The sentence form, for the viewer: "0.42% of pixels changed". */
export function changeSummary(diff: Pick<Build.DiffItem, 'score' | 'sizeChanged'>): string {
  if (diff.sizeChanged) return 'Size changed'
  return diff.score === null ? '' : `${formatPercent(diff.score)}% of pixels changed`
}

/** A finished build with changes is the only kind that can be approved or rejected. */
export const isReviewable = (build: Pick<Build.ListItem, 'status' | 'conclusion'>): boolean =>
  build.status === 'complete' && build.conclusion === 'changes_detected'

/** A snapshot that differs from the baseline needs a decision; an unchanged one needs none. */
export const needsDecision = (diff: Pick<Build.DiffItem, 'status'>): boolean =>
  diff.status !== null && diff.status !== 'unchanged'

/** How many of the snapshots that need a decision have one ("2 of 5 reviewed"). */
export function reviewProgress(
  diffs: readonly Build.DiffItem[],
  build: ReviewStatus,
): { reviewed: number; total: number } {
  const needing = diffs.filter(needsDecision)
  return {
    total: needing.length,
    reviewed: needing.filter((d) => shotDecision(d, build) !== 'pending').length,
  }
}

/** The names of the snapshots that still wait for a decision: what Approve all decides. */
export const undecidedNames = (diffs: readonly Build.DiffItem[], build: ReviewStatus): string[] =>
  diffs.filter((d) => needsDecision(d) && shotDecision(d, build) === 'pending').map((d) => d.name)

/** The people with an open review request on the build: asked, and the request not closed since. */
export const openReviewers = (events: readonly Activity.Event[]): Set<string> => {
  const open = new Set<string>()
  for (const e of events) {
    if (e.type === 'review_requested' && e.reviewer) open.add(e.reviewer.id)
    else if (e.type === 'review_request_closed' && e.reviewer) open.delete(e.reviewer.id)
  }
  return open
}
