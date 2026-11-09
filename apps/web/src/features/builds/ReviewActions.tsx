import type { Build, ReviewState } from '@circi/api'
import { Button, CancelIcon, Kbd, TaskDoneIcon, Text, Tooltip, useAnnounce } from '@circi/ui'
import { useState } from 'react'

import { useReviewSnapshots } from '#features/builds/api/index.ts'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import { shotDecision } from './diff-status.ts'
import { RejectDialog } from './RejectDialog.tsx'
import { isReviewable, needsDecision, undecidedNames } from './review-model.ts'

/** What the review screen can do about decisions, shared by the buttons and the a / ⇧A / r keys. */
export interface ReviewControls {
  /** Only the decision that isn't already in force on the current snapshot is offered. */
  canApprove: boolean
  canReject: boolean
  /** Some changed snapshot has no decision yet. */
  canApproveAll: boolean
  pending: boolean
  error: Error | null
  rejecting: boolean
  /** Approves the current snapshot. */
  approve: () => void
  /** Approves every changed snapshot that has no decision yet. */
  approveAll: () => void
  /** Rejecting asks first: it holds back the merge. */
  askReject: () => void
  cancelReject: () => void
  /** Rejects the current snapshot with the reason the dialog collected. */
  confirmReject: (reason: string) => void
}

/**
 * The decisions on the snapshots of a finished build with changes: the current one (A, R) or
 * every undecided one (⇧A). The build's status follows from them. A result is announced to
 * screen readers.
 */
export function useReviewControls(
  data: Build.Detail,
  selected: Build.DiffItem | undefined,
): ReviewControls {
  const { build, team } = data
  const review = useReviewSnapshots(team.workspaceSlug, team.slug, build.number)
  const announce = useAnnounce()
  const [rejecting, setRejecting] = useState(false)
  const reviewable = isReviewable(build)
  const current =
    selected && needsDecision(selected) ? shotDecision(selected, build.reviewStatus) : undefined
  const canApprove = reviewable && current !== undefined && current !== 'approved'
  const canReject = reviewable && current !== undefined && current !== 'rejected'
  const undecided = reviewable ? undecidedNames(data.diffs, build.reviewStatus) : []
  const canApproveAll = undecided.length > 0

  function decide(
    snapshotNames: string[],
    decision: ReviewState,
    message: string,
    reason?: string,
  ) {
    review.mutate(reason ? { snapshotNames, decision, reason } : { snapshotNames, decision }, {
      onSuccess: () => announce(message),
      onSettled: () => setRejecting(false),
    })
  }

  return {
    canApprove,
    canReject,
    canApproveAll,
    pending: review.isPending,
    error: review.error,
    rejecting,
    approve: () => {
      if (canApprove && selected && !review.isPending) {
        decide([selected.name], 'approved', `${selected.name} approved.`)
      }
    },
    approveAll: () => {
      if (canApproveAll && !review.isPending) {
        decide(undecided, 'approved', `${undecided.length} snapshots approved.`)
      }
    },
    askReject: () => {
      if (canReject && !review.isPending) setRejecting(true)
    },
    cancelReject: () => setRejecting(false),
    confirmReject: (reason) => {
      if (canReject && selected && !review.isPending) {
        decide([selected.name], 'rejected', `${selected.name} rejected.`, reason)
      }
    },
  }
}

/** Reject, Approve and Approve all, each with its key in a tooltip, and the confirmation for Reject. */
export function ReviewActions({ review, snapshotName }: ReviewActions.Props) {
  return (
    <>
      {review.canReject ? (
        <Tooltip
          content={
            <>
              Reject this snapshot <Kbd>r</Kbd>
            </>
          }
        >
          <Button
            variant="danger"
            leading={<CancelIcon />}
            disabled={review.pending}
            onClick={review.askReject}
          >
            Reject
          </Button>
        </Tooltip>
      ) : null}
      {review.canApprove ? (
        <Tooltip
          content={
            <>
              Approve this snapshot; on the default branch it becomes the baseline <Kbd>a</Kbd>
            </>
          }
        >
          <Button leading={<TaskDoneIcon />} disabled={review.pending} onClick={review.approve}>
            Approve
          </Button>
        </Tooltip>
      ) : null}
      {review.canApproveAll ? (
        <Tooltip
          content={
            <>
              Approve every snapshot that has no decision yet <Kbd>⇧</Kbd> <Kbd>A</Kbd>
            </>
          }
        >
          <Button
            variant="primary"
            leading={<TaskDoneIcon />}
            loading={review.pending && !review.rejecting}
            disabled={review.pending}
            onClick={review.approveAll}
          >
            Approve all
          </Button>
        </Tooltip>
      ) : null}
      <RejectDialog
        open={review.rejecting}
        subject={snapshotName ?? 'this snapshot'}
        pending={review.pending}
        onCancel={review.cancelReject}
        onReject={review.confirmReject}
      />
    </>
  )
}

export namespace ReviewActions {
  export interface Props {
    review: ReviewControls
    /** The snapshot Reject and Approve act on. */
    snapshotName: string | undefined
  }
}

/** One line on who decided and when; nothing while the build still waits for a decision. */
export function ReviewNote({ data }: ReviewNote.Props) {
  const { build, reviews } = data
  if (!isReviewable(build)) return null
  const latest = reviews[0]
  // A build still waiting for a decision says so in its chip and the Approve tooltip.
  if (!latest || build.reviewStatus === 'pending') return null
  const verb = latest.state === 'approved' ? 'Approved' : 'Rejected'
  return (
    <Text variant="small" tone="secondary" as="p">
      {latest.source === 'auto' ? (
        <>Approved automatically, because it’s a build on the default branch.</>
      ) : latest.source === 'rerun' ? (
        <>
          Approved automatically: this commit’s exact screenshots were approved in an earlier build.
        </>
      ) : (
        <>
          {verb} by {latest.userName ?? 'someone whose account was removed'}{' '}
          <RelativeTime iso={latest.createdAt} />.
        </>
      )}
    </Text>
  )
}

export namespace ReviewNote {
  export interface Props {
    data: Build.Detail
  }
}
