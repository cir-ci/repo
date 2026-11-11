import type { Build, ReviewState } from '@circi/api'
import { Button, CancelIcon, Kbd, TaskDoneIcon, Text, Tooltip } from '@circi/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useReviewSnapshots } from '#features/builds/api/index.ts'
import { useRejectReasonRequired } from '#features/projects/api/index.ts'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { toast } from '#lib/toast.ts'
import { refreshAll, withUndo } from '#lib/undo.ts'

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
  /** The project asks for a reason when someone rejects. */
  reasonRequired: boolean
  /** Approves the current snapshot. */
  approve: () => void
  /** Approves every changed snapshot that has no decision yet. */
  approveAll: () => void
  /** Rejecting asks first: it holds back the merge. */
  askReject: () => void
  cancelReject: () => void
  /** Rejects the snapshot the dialog asked about with the reason it collected. */
  confirmReject: (reason: string) => void
  /** A snapshot's own decisions, for its row's right-click menu (it needn't be the selected one). */
  canApproveFor: (d: Build.DiffItem) => boolean
  canRejectFor: (d: Build.DiffItem) => boolean
  approveFor: (d: Build.DiffItem) => void
  askRejectFor: (d: Build.DiffItem) => void
  /** The snapshot the reject dialog is asking about when it isn't the selected one (from a row's menu). */
  rejectName: string | undefined
}

/**
 * The decisions on the snapshots of a finished build with changes: the current one (A, R) or
 * every undecided one (⇧A). The build's status follows from them. Each decision acts at once and
 * shows a toast with Undo (the server takes it back unless something newer changed the same
 * thing); rejecting asks for a reason first when the project requires one.
 */
export function useReviewControls(
  data: Build.Detail,
  selected: Build.DiffItem | undefined,
  /** Called once the current snapshot's approval is saved (not for Approve all or a rejection). */
  onApproved?: (approved: Build.DiffItem) => void,
): ReviewControls {
  const { build, project } = data
  const review = useReviewSnapshots(project.workspaceSlug, project.slug, build.number)
  const reasonRequired = useRejectReasonRequired(project.workspaceSlug, project.slug)
  const queryClient = useQueryClient()
  const [rejecting, setRejecting] = useState(false)
  const [rejectName, setRejectName] = useState<string | undefined>(undefined)
  const reviewable = isReviewable(build)
  const decisionOf = (d: Build.DiffItem | undefined) =>
    d && needsDecision(d) ? shotDecision(d, build.reviewStatus) : undefined
  const canApproveFor = (d: Build.DiffItem) => {
    const current = decisionOf(d)
    return reviewable && current !== undefined && current !== 'approved'
  }
  const canRejectFor = (d: Build.DiffItem) => {
    const current = decisionOf(d)
    return reviewable && current !== undefined && current !== 'rejected'
  }
  const canApprove = selected !== undefined && canApproveFor(selected)
  const canReject = selected !== undefined && canRejectFor(selected)
  const undecided = reviewable ? undecidedNames(data.diffs, build.reviewStatus) : []
  const canApproveAll = undecided.length > 0

  function decide(
    snapshotNames: string[],
    decision: ReviewState,
    message: string,
    reason?: string,
    after?: () => void,
  ) {
    review.mutate(reason ? { snapshotNames, decision, reason } : { snapshotNames, decision }, {
      onSuccess: (answer) => {
        toast.show(
          // No token: the decision changed nothing (everything was decided that way already).
          withUndo(
            answer.undo ? message : 'Nothing to change',
            answer.undo,
            { workspace: project.workspaceSlug, project: project.slug },
            refreshAll(queryClient),
            `Couldn't undo: ${message.toLowerCase()}`,
          ),
        )
        after?.()
      },
      onSettled: () => {
        setRejecting(false)
        setRejectName(undefined)
      },
    })
  }

  return {
    canApprove,
    canReject,
    canApproveAll,
    canApproveFor,
    canRejectFor,
    rejectName,
    approveFor: (d) => {
      if (canApproveFor(d) && !review.isPending) {
        decide([d.name], 'approved', `Approved ${d.name}`, undefined, () => {
          if (d.id === selected?.id) onApproved?.(d)
        })
      }
    },
    askRejectFor: (d) => {
      if (canRejectFor(d) && !review.isPending) {
        setRejectName(d.name)
        setRejecting(true)
      }
    },
    pending: review.isPending,
    error: review.error,
    rejecting,
    reasonRequired,
    approve: () => {
      if (canApprove && selected && !review.isPending) {
        decide([selected.name], 'approved', `Approved ${selected.name}`, undefined, () =>
          onApproved?.(selected),
        )
      }
    },
    approveAll: () => {
      if (canApproveAll && !review.isPending) {
        decide(
          undecided,
          'approved',
          `Approved ${undecided.length} ${undecided.length === 1 ? 'screenshot' : 'screenshots'}`,
        )
      }
    },
    askReject: () => {
      if (canReject && !review.isPending) {
        setRejectName(undefined)
        setRejecting(true)
      }
    },
    cancelReject: () => {
      setRejecting(false)
      setRejectName(undefined)
    },
    confirmReject: (reason) => {
      const name = rejectName ?? (canReject ? selected?.name : undefined)
      if (name && !review.isPending) decide([name], 'rejected', `Rejected ${name}`, reason)
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
              Reject this screenshot <Kbd>r</Kbd>
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
              Approve this screenshot; on the default branch it becomes the baseline <Kbd>a</Kbd>
            </>
          }
        >
          <Button leading={<TaskDoneIcon />} disabled={review.pending} onClick={review.approve}>
            Approve
          </Button>
        </Tooltip>
      ) : null}
      {review.canApproveAll ? (
        <Tooltip content="Approve every screenshot that has no decision yet">
          <Button
            variant="primary"
            leading={<TaskDoneIcon />}
            loading={review.pending && !review.rejecting}
            disabled={review.pending}
            onClick={review.approveAll}
          >
            Approve all <Kbd>⇧A</Kbd>
          </Button>
        </Tooltip>
      ) : null}
      <RejectDialog
        open={review.rejecting}
        subject={review.rejectName ?? snapshotName ?? 'this screenshot'}
        pending={review.pending}
        reasonRequired={review.reasonRequired}
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
        <>Approved automatically: a build on the default branch.</>
      ) : latest.source === 'rerun' ? (
        <>
          {verb} automatically: an earlier build of this commit, with the same screenshots, was{' '}
          {latest.state}.
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
