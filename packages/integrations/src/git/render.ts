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
  /** A build with no changes that its project approves by hand and nobody has approved yet. */
  awaitsApproval?: boolean
  /** How far the review has come, once the build has changes to review. */
  review?: ReportedReview
  /** Dashboard address of the build page. */
  url: string
}

/** The decisions on a build's changed snapshots, and who decided last. */
export interface ReportedReview {
  approved: number
  rejected: number
  /** Changed snapshots nobody has decided yet. */
  pending: number
  /** Who set the build's approved or rejected status; null for an automatic approval. */
  decidedBy: string | null
}

/** A hosted site of the pull request's newest commit, linked to its commit address. */
export interface ReportedSite {
  name: string
  /** What kind it is, in words ("Storybook", "Playwright report"). */
  kindLabel: string
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

/** What to do next on a build that awaits a decision, in the words its check shows. */
function nextStep(build: ReportedBuild): string {
  const reply =
    build.prNumber === null
      ? ''
      : ' or reply `/circi approve` or `/circi reject` on the pull request'
  return `Approve or reject it here${reply}, or open the build to see it.`
}

export const checkName = (buildName: string) => `CirCI / ${buildName}`

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "3 changed · 1 added", or an empty string for nothing. */
export function describeCounts(c: ReportedBuild['counts']): string {
  return [
    c.changed ? `${c.changed} changed` : '',
    c.added ? `${c.added} added` : '',
    c.removed ? `${c.removed} removed` : '',
    c.failed ? `${c.failed} couldn't be read` : '',
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
  if (build.conclusion !== 'changes_detected' && build.awaitsApproval) {
    return {
      ...base,
      actions: [
        { identifier: 'approve' as const, label: 'Approve', description: 'Accept this build' },
      ],
      status: 'completed',
      conclusion: options.blockMergeOnChanges ? 'action_required' : 'success',
      title: 'No visual changes: approval required',
      summary: `${plural(build.counts.total, 'screenshot')} compared, none differ. This project approves builds by hand. ${nextStep(build)}\n\n${link}`,
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
  if (build.counts.failed > 0) {
    // An input problem no review settles: until the build is uploaded again with valid PNGs the
    // check fails a project that blocks merges, and is neutral otherwise, whatever was approved
    // (the same rule as `buildOutcome` and a build that failed to process).
    const n = build.counts.failed
    return {
      ...base,
      status: 'completed',
      conclusion: options.blockMergeOnChanges ? 'failure' : 'neutral',
      title: `${plural(n, 'screenshot')} couldn't be read`,
      summary: `${counts}. Upload the build again with valid PNGs. The other screenshots can still be reviewed.\n\n${link}`,
    }
  }
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
      summary: `${counts}. These screenshots keep changing on the default branch, and this project doesn't hold merges for them. ${nextStep(build)}\n\n${link}`,
    }
  }
  return {
    ...base,
    actions,
    status: 'completed',
    conclusion: options.blockMergeOnChanges ? 'action_required' : 'success',
    title: `${counts}: review required`,
    summary: `${counts}. ${nextStep(build)}\n\n${link}`,
  }
}

/** Hidden marker that lets the comment be found again and edited in place. */
export const PR_COMMENT_MARKER = '<!-- circi:pr-summary -->'

/** "2 approved · 1 pending", only when the snapshots are not all decided the same way. */
function reviewDetail(review: ReportedReview | undefined): string {
  if (!review) return ''
  const parts = [
    review.approved ? `${review.approved} approved` : '',
    review.rejected ? `${review.rejected} rejected` : '',
    review.pending ? `${review.pending} pending` : '',
  ].filter(Boolean)
  return parts.length > 1 ? ` (${parts.join(' · ')})` : ''
}

function reviewCell(b: ReportedBuild): string {
  if (b.status === 'error') return '—'
  if (b.status !== 'complete') return '…'
  if (b.conclusion !== 'changes_detected') return b.awaitsApproval ? `[Approve](${b.url})` : '—'
  const by = b.review?.decidedBy ? ` by ${b.review.decidedBy}` : ''
  const detail = reviewDetail(b.review)
  if (b.reviewStatus === 'approved') return `✅ Approved${by}${detail}`
  if (b.reviewStatus === 'rejected') return `❌ Rejected${by}${detail}`
  return `[Review](${b.url})${detail}`
}

function statusCell(b: ReportedBuild): string {
  if (b.status === 'error') return '❌ Failed'
  if (b.status !== 'complete') return '⏳ Processing'
  if (b.counts.failed > 0) return `❌ ${plural(b.counts.failed, 'screenshot')} couldn't be read`
  if (b.conclusion === 'changes_detected') return '🟡 Changes detected'
  return b.awaitsApproval ? '🟡 No changes, approval required' : '✅ No changes'
}

/** A build that is waiting for someone to approve or reject it. */
function needsDecision(b: ReportedBuild): boolean {
  if (b.status !== 'complete') return false
  return b.conclusion === 'changes_detected' ? b.reviewStatus === 'pending' : !!b.awaitsApproval
}

function sitesSection(sites: ReportedSite[]): string[] {
  if (sites.length === 0) return []
  return [
    '',
    '**Hosted sites for this commit**',
    '',
    ...sites.map((site) => {
      const same = site.name.toLowerCase() === site.kindLabel.toLowerCase()
      return `- [${site.name}](${site.url})${same ? '' : ` · ${site.kindLabel}`}`
    }),
  ]
}

/**
 * The pull request comment: one row per build name with its review status, and the sites hosted
 * for the newest commit (the section is left out when there are none).
 */
export function prCommentBody(
  builds: ReportedBuild[],
  extras: { sites?: ReportedSite[] } = {},
): string {
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
    ...sitesSection(extras.sites ?? []),
    '',
    builds.some(needsDecision)
      ? 'Review the builds in CirCI (the links above), or reply `/circi approve` or `/circi reject` here. `/circi rerun` processes them again.'
      : 'Reply `/circi approve`, `/circi reject` or `/circi rerun` to act on the latest builds.',
  ].join('\n')
}

/** Hidden marker of the one help comment per pull request: refusals and ignored commands edit it in place. */
export const HELP_COMMENT_MARKER = '<!-- circi:help -->'

/** Why a `/circi` command did nothing. */
export type CommandIgnoredReason = 'no_build' | 'processing' | 'failed' | 'nothing_to_review'

/** The one short reply for a command that applied to nothing. */
export function ignoredReply(
  command: 'approve' | 'reject' | 'rerun',
  reason: CommandIgnoredReason = 'no_build',
): string {
  switch (reason) {
    case 'processing':
      return `The latest build is still processing. Reply \`/circi ${command}\` again when its check finishes.`
    case 'failed':
      return `The latest build failed, so there's nothing to ${command}. \`/circi rerun\` processes it again.`
    case 'nothing_to_review':
      return `Nothing to ${command}: the latest build has no visual changes, and this project doesn't require approval.`
    default:
      return "There's no CirCI build for this pull request yet. Reply again once your tests have uploaded screenshots."
  }
}

/** `/circi approve` and friends, from a comment's text; the first matching line wins. */
export function parseCommand(body: string): 'approve' | 'reject' | 'rerun' | undefined {
  for (const line of body.split('\n')) {
    const word = /^\s*\/circi\s+(approve|reject|rerun)\s*$/i.exec(line)?.[1]?.toLowerCase()
    if (word === 'approve' || word === 'reject' || word === 'rerun') return word
  }
  return undefined
}
