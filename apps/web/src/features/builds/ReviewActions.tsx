import type { Build, ReviewState } from '@circi/api'
import { Button, CancelIcon, Kbd, TaskDoneIcon, Text, Tooltip, useAnnounce } from '@circi/ui'
import { useState } from 'react'

import { RelativeTime } from '#lib/RelativeTime.tsx'

import { useReviewBuild } from './api.ts'
import { RejectDialog } from './RejectDialog.tsx'
import { isReviewable } from './review-model.ts'

/** What the review screen can do about a build's decision, shared by the buttons and the a / r keys. */
export interface ReviewControls {
  /** Only the decision that isn't already in force is offered. */
  canApprove: boolean
  canReject: boolean
  pending: boolean
  error: Error | null
  rejecting: boolean
  approve: () => void
  /** Rejecting asks first: it holds back the merge. */
  askReject: () => void
  cancelReject: () => void
  /** Rejects with the reason the dialog collected. */
  confirmReject: (reason: string) => void
}

/**
 * The decisions on a finished build with changes. After approving you're left with "Reject" to
 * change your mind, and the other way round. A result is announced to screen readers.
 */
export function useReviewControls(data: Build.Detail): ReviewControls {
  const { build, project } = data
  const review = useReviewBuild(project.orgSlug, project.slug, build.number)
  const announce = useAnnounce()
  const [rejecting, setRejecting] = useState(false)
  const reviewable = isReviewable(build)
  const canApprove = reviewable && build.reviewStatus !== 'approved'
  const canReject = reviewable && build.reviewStatus !== 'rejected'

  function decide(state: ReviewState, reason?: string) {
    review.mutate(reason ? { state, reason } : { state }, {
      onSuccess: () => announce(`Build #${build.number} ${state}.`),
      onSettled: () => setRejecting(false),
    })
  }

  return {
    canApprove,
    canReject,
    pending: review.isPending,
    error: review.error,
    rejecting,
    approve: () => {
      if (canApprove && !review.isPending) decide('approved')
    },
    askReject: () => {
      if (canReject && !review.isPending) setRejecting(true)
    },
    cancelReject: () => setRejecting(false),
    confirmReject: (reason) => {
      if (canReject && !review.isPending) decide('rejected', reason)
    },
  }
}

/** Reject and Approve all, each with its key in a tooltip, and the confirmation for Reject. */
export function ReviewActions({ review, buildNumber }: ReviewActions.Props) {
  return (
    <>
      {review.canReject ? (
        <Tooltip
          content={
            <>
              Reject these changes <Kbd>r</Kbd>
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
              Accept these changes; later builds are compared with this one <Kbd>a</Kbd>
            </>
          }
        >
          <Button
            variant="primary"
            leading={<TaskDoneIcon />}
            loading={review.pending && !review.rejecting}
            disabled={review.pending}
            onClick={review.approve}
          >
            Approve all
          </Button>
        </Tooltip>
      ) : null}
      <RejectDialog
        open={review.rejecting}
        buildNumber={buildNumber}
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
    buildNumber: number
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
