/**
 * What CirCI says on a git host about a build (PLAN §7.4): one status per build name, and one
 * summary comment per pull request. Pure functions, so every host adapter says the same thing.
 */

export interface ReportedBuild {
  number: number
  name: string
  status: string
  conclusion: string | null
  reviewStatus: string
  prNumber: number | null
  errorMessage: string | null
  counts: {
    added: number
    removed: number
    changed: number
    failed: number
    total: number
  }
  /** Every change is a flaky screenshot (only looked up while flaky ones don't block). */
  flakyOnly?: boolean
  /** Dashboard address of the build page. */
  url: string
}

export interface CheckReport {
  /** The check's name, `CirCI / <build name>`. */
  name: string
  status: 'in_progress' | 'completed'
  conclusion?: CheckReport.Conclusion
  title: string
  summary: string
  /** Buttons on the check (GitHub `requested_action`). */
  actions: {
    identifier: 'approve' | 'reject'
    label: string
    description: string
  }[]
}

export namespace CheckReport {
  export type Conclusion = 'success' | 'failure' | 'action_required' | 'neutral'
}

export const checkName = (buildName: string) => `CirCI / ${buildName}`

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "3 changed · 1 added", or an empty string for nothing. */
export function describeCounts(c: ReportedBuild['counts']): string {
  return [
    c.changed ? `${c.changed} changed` : '',
    c.added ? `${c.added} added` : '',
    c.removed ? `${c.removed} removed` : '',
    c.failed ? `${c.failed} failed` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The status mapping table of PLAN §7.4. With `blockMergeOnChanges` an unreviewed change holds
 * the check at `action_required` (it blocks the merge if the check is required); without it the
 * check passes and only says how many changes await review. With `flakyBlocksMerge` off, a build
 * whose only changes are flaky screenshots passes too, saying so.
 */
export function checkReport(
  build: ReportedBuild,
  options: { blockMergeOnChanges: boolean; flakyBlocksMerge?: boolean },
): CheckReport {
  const name = checkName(build.name)
  const link = `[Open build #${build.number} in CirCI](${build.url})`
  const base = { name, actions: [] as CheckReport['actions'] }

  if (build.status === 'error') {
    return {
      ...base,
      status: 'completed',
      conclusion: options.blockMergeOnChanges ? 'failure' : 'neutral',
      title: 'Processing failed',
      summary: `${build.errorMessage ?? 'The screenshots could not be processed.'}\n\n${link}`,
    }
  }
  if (build.status !== 'complete') {
    return {
      ...base,
      status: 'in_progress',
      title: 'Processing screenshots…',
      summary: link,
    }
  }
  if (build.conclusion !== 'changes_detected') {
    return {
      ...base,
      status: 'completed',
      conclusion: 'success',
      title: 'No visual changes',
      summary: `${plural(build.counts.total, 'screenshot')} compared, none differ.\n\n${link}`,
    }
  }

  const counts = describeCounts(build.counts)
  const actions: CheckReport['actions'] = [
    ...(build.reviewStatus === 'approved'
      ? []
      : [
          {
            identifier: 'approve' as const,
            label: 'Approve',
            description: 'Accept these changes',
          },
        ]),
    ...(build.reviewStatus === 'rejected'
      ? []
      : [
          {
            identifier: 'reject' as const,
            label: 'Reject',
            description: 'Reject these changes',
          },
        ]),
  ]
  if (build.reviewStatus === 'approved') {
    return {
      ...base,
      actions,
      status: 'completed',
      conclusion: 'success',
      title: `Changes approved (${counts})`,
      summary: link,
    }
  }
  if (build.reviewStatus === 'rejected') {
    return {
      ...base,
      actions,
      status: 'completed',
      conclusion: 'failure',
      title: `Changes rejected (${counts})`,
      summary: link,
    }
  }
  if (build.flakyOnly && options.flakyBlocksMerge === false) {
    return {
      ...base,
      actions,
      status: 'completed',
      conclusion: 'success',
      title: `Only flaky screenshots changed (${counts})`,
      summary: `${counts}. These screenshots keep changing on the default branch, and this project does not hold merges for them. Approve or reject the changes here, or open the build to see them.\n\n${link}`,
    }
  }
  return {
    ...base,
    actions,
    status: 'completed',
    conclusion: options.blockMergeOnChanges ? 'action_required' : 'success',
    title: `${counts}: review required`,
    summary: `${counts}. Approve or reject the changes here, or open the build to see them.\n\n${link}`,
  }
}

/** Hidden marker that lets the comment be found again and edited in place. */
export const PR_COMMENT_MARKER = '<!-- circi:pr-summary -->'

function reviewCell(b: ReportedBuild): string {
  if (b.status === 'error') return '—'
  if (b.status !== 'complete') return '…'
  if (b.conclusion !== 'changes_detected') return '—'
  return b.reviewStatus === 'approved'
    ? '✅ Approved'
    : b.reviewStatus === 'rejected'
      ? '❌ Rejected'
      : `[Review](${b.url})`
}

function statusCell(b: ReportedBuild): string {
  if (b.status === 'error') return '❌ Failed'
  if (b.status !== 'complete') return '⏳ Processing'
  return b.conclusion === 'changes_detected' ? '🟡 Changes detected' : '✅ No changes'
}

/** The pull request comment: one row per build name. */
export function prCommentBody(builds: ReportedBuild[]): string {
  const rows = builds.map(
    (b) =>
      `| [${b.name}](${b.url}) | ${statusCell(b)} | ${b.conclusion === 'changes_detected' ? describeCounts(b.counts) : '—'} | ${reviewCell(b)} |`,
  )
  return [
    PR_COMMENT_MARKER,
    '### CirCI visual tests',
    '',
    '| Build | Status | Changes | Review |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    'Reply `/circi approve`, `/circi reject` or `/circi rerun` to act on the latest build.',
  ].join('\n')
}

/** `/circi approve` and friends, from a comment's text; the first matching line wins. */
export function parseCommand(body: string): 'approve' | 'reject' | 'rerun' | undefined {
  for (const line of body.split('\n')) {
    const word = /^\s*\/circi\s+(approve|reject|rerun)\s*$/i.exec(line)?.[1]?.toLowerCase()
    if (word === 'approve' || word === 'reject' || word === 'rerun') return word
  }
  return undefined
}
