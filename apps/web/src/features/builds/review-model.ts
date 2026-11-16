import type { Activity, Build, ReviewStatus } from '@circi/api'

import { shotDecision, type ShotKind } from './diff-status.ts'

/**
 * Review order: what needs a decision first, then what doesn't. Only
 * what needs no attention starts collapsed (Flaky opens when it holds the only changes).
 */
export const GROUP_ORDER: readonly { kind: ShotKind; title: string; open: boolean }[] = [
  // Screenshots the server couldn't read come first and stay open: nothing else about the
  // build is trustworthy until they are uploaded again.
  { kind: 'failed', title: "Couldn't read", open: true },
  { kind: 'changed', title: 'Changed', open: true },
  { kind: 'added', title: 'Added', open: true },
  { kind: 'removed', title: 'Removed', open: true },
  { kind: 'flaky', title: 'Flaky', open: false },
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
  const groups = GROUP_ORDER.flatMap((g) => {
    const items = diffs.filter((d) => shotKind(d, flaky) === g.kind)
    return items.length > 0 ? [{ ...g, items }] : []
  })
  // Flaky ones start folded away, unless they are the only changes in the build: then they are
  // what there is to look at.
  const onlyFlaky = !groups.some((g) => g.kind !== 'unchanged' && g.kind !== 'flaky')
  const flakyGroup = groups.find((g) => g.kind === 'flaky')
  if (flakyGroup && onlyFlaky) flakyGroup.open = true
  return groups
}

/** Every screenshot in the order the list shows them, which is the order j and k walk. */
export const orderShots = (groups: readonly ShotGroup[]): Build.DiffItem[] =>
  groups.flatMap((g) => g.items)

/**
 * The screenshot to open when none is chosen: the first that needs a decision, else one that
 * couldn't be read, else the first.
 */
export function defaultShot(groups: readonly ShotGroup[]): Build.DiffItem | undefined {
  const attention = groups.find(
    (g) => g.kind !== 'unchanged' && g.kind !== 'flaky' && g.kind !== 'failed',
  )
  const unreadable = groups.find((g) => g.kind === 'failed')
  return attention?.items[0] ?? unreadable?.items[0] ?? orderShots(groups)[0]
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

/**
 * The screenshot to show after `current` is approved: the next one in list order that still needs a
 * decision (wrapping round to the top), never `current` itself. Undefined when none is left.
 */
export function nextToReview(
  ordered: readonly Build.DiffItem[],
  current: Build.DiffItem,
  build: ReviewStatus,
): Build.DiffItem | undefined {
  const at = ordered.indexOf(current)
  const after = [...ordered.slice(at + 1), ...ordered.slice(0, Math.max(at, 0))]
  return after.find(
    (d) => d.id !== current.id && needsDecision(d) && shotDecision(d, build) === 'pending',
  )
}

/**
 * A snapshot that differs from the baseline needs a decision; an unchanged one needs none, and
 * one the server couldn't read has nothing to approve or reject (the server refuses it too).
 */
export const needsDecision = (diff: Pick<Build.DiffItem, 'status'>): boolean =>
  diff.status !== null && diff.status !== 'unchanged' && diff.status !== 'failed'

/** Why a screenshot couldn't be read: the stored message without its lead ("not a PNG"). */
export function unreadableReason(message: string | null): string {
  const reason = message?.replace(/^Couldn't read this image:\s*/, '').replace(/\.$/, '')
  return reason || "the file couldn't be decoded"
}

/** How many screenshots the server couldn't read. */
export const unreadableCount = (diffs: readonly Pick<Build.DiffItem, 'status'>[]): number =>
  diffs.filter((d) => d.status === 'failed').length

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
export const openReviewers = (events: readonly Activity.Event[]): Set<string> =>
  new Set(openReviewerPeople(events).map((p) => p.id))

/** The same people, with their names, in the order they were asked. */
export function openReviewerPeople(events: readonly Activity.Event[]): Activity.Person[] {
  const open = new Map<string, Activity.Person>()
  for (const e of events) {
    if (e.type === 'review_requested' && e.reviewer) open.set(e.reviewer.id, e.reviewer)
    else if (e.type === 'review_request_closed' && e.reviewer) open.delete(e.reviewer.id)
  }
  return [...open.values()]
}

/** An open request: who was asked, by whom (null: assigned automatically) and when. */
export interface ReviewRequest {
  person: Activity.Person
  by: Activity.Person | null
  at: string
}

/** The open requests with who asked and when, in the order they were made. */
export function openReviewRequests(events: readonly Activity.Event[]): ReviewRequest[] {
  const open = new Map<string, ReviewRequest>()
  for (const e of events) {
    if (e.type === 'review_requested' && e.reviewer)
      open.set(e.reviewer.id, { person: e.reviewer, by: e.by, at: e.at })
    else if (e.type === 'review_request_closed' && e.reviewer) open.delete(e.reviewer.id)
  }
  return [...open.values()]
}

/**
 * How the build's baseline was chosen, for the Details tab: "where this branch started" for an
 * ancestry match, the fallback's reason, or nothing yet when there is no baseline.
 */
export function baselineHow(
  build: Pick<Build.Detail['build'], 'baselineSource' | 'ancestryStatus'>,
  defaultBranch: string,
): string {
  if (build.baselineSource === 'fallback')
    return `the latest on ${defaultBranch}: this build's git history wasn't available`
  return build.ancestryStatus === 'truncated'
    ? 'where this branch started, as far as its git history reaches'
    : 'where this branch started'
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

/** "45m", "22h", "3d": a span of time as one rounded-down figure; at least a minute. */
export function shortSpan(ms: number): string {
  if (ms < HOUR_MS) return `${Math.max(1, Math.floor(ms / MINUTE_MS))}m`
  if (ms < 48 * HOUR_MS) return `${Math.floor(ms / HOUR_MS)}h`
  return `${Math.floor(ms / (24 * HOUR_MS))}d`
}

/**
 * Where the review target stands at `now`: "22h left" or, once past it, "Overdue 2h". Null when
 * nothing is counting down (no target, or nobody was asked).
 */
export function reviewTargetStatus(
  target: Build.Detail['reviewTarget'],
  now: number,
): { overdue: boolean; short: string; long: string } | null {
  if (!target.dueAt) return null
  const left = Date.parse(target.dueAt) - now
  const of = target.hours === null ? '' : ` of ${target.hours}h`
  if (left >= 0) {
    const span = shortSpan(left)
    return { overdue: false, short: `${span} left`, long: `${span} left${of}` }
  }
  const late = `Overdue ${shortSpan(-left)}`
  return {
    overdue: true,
    short: late,
    long: target.hours === null ? late : `${late}, past the ${target.hours}h target`,
  }
}

/** A run of identical decisions, collapsed: who decided, how, how many and the latest time. */
export interface DecisionGroup {
  decision: 'approved' | 'rejected'
  /** The reviewer's name; null for an automatic decision (or an account that is gone). */
  by: string | null
  automatic: boolean
  reason: string | null
  count: number
  /** ISO time of the newest. */
  at: string
  /** The screenshots it covers (empty for the build's own decisions). */
  names: string[]
}

/**
 * Identical decisions (same outcome, same reviewer, same reason) as one entry with a count, in the
 * order of their first appearance: "Approved by Olivia Owner" six times is one line, not six.
 */
export function groupDecisions(
  items: readonly {
    decision: 'approved' | 'rejected'
    by: string | null
    automatic: boolean
    reason: string | null
    at: string
    name?: string
  }[],
): DecisionGroup[] {
  const groups = new Map<string, DecisionGroup>()
  for (const item of items) {
    const key = JSON.stringify([item.decision, item.by, item.automatic, item.reason])
    const group = groups.get(key)
    if (group) {
      group.count += 1
      if (item.at > group.at) group.at = item.at
      if (item.name !== undefined) group.names.push(item.name)
    } else {
      groups.set(key, {
        decision: item.decision,
        by: item.by,
        automatic: item.automatic,
        reason: item.reason,
        count: 1,
        at: item.at,
        names: item.name === undefined ? [] : [item.name],
      })
    }
  }
  return [...groups.values()]
}

/** "Approved by Olivia Owner", "Rejected", "Approved automatically": who did what, without a count. */
export function decisionText(g: Pick<DecisionGroup, 'decision' | 'by' | 'automatic'>): string {
  const verb = g.decision === 'approved' ? 'Approved' : 'Rejected'
  if (g.automatic) return `${verb} automatically`
  if (g.by) return `${verb} by ${g.by}`
  return g.decision === 'approved' ? `${verb} automatically` : verb
}
