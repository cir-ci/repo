import { Badge, Button, CancelIcon, ImagesIcon, ReviewIcon, Sheet, TaskDoneIcon } from '@circi/ui'
import type { ReactNode } from 'react'

import { RejectDialog } from './RejectDialog.tsx'
import type { ReviewControls } from './ReviewActions.tsx'

import styles from './BuildPhone.module.css'

/**
 * The build page's bottom bar on a phone (canvas: Phone, the build page): the screenshot list
 * ("3 / 12"), Comments with its count, Reject and, the one primary, Approve. Each is 44px or
 * taller and the bar clears the home indicator. Approve all and Request review are in the More
 * sheet, not here. It carries the reject dialog (the reason prompt), the same one the desktop
 * buttons use. Reject and Approve show only while they apply, like the desktop buttons.
 */
export function PhoneReviewBar({
  review,
  reviewable,
  snapshotName,
  position,
  comments,
  onShots,
  onComments,
}: PhoneReviewBar.Props) {
  return (
    <div className={styles.bar} role="group" aria-label="Review">
      <Button
        className={styles.shots}
        leading={<ImagesIcon size={18} />}
        aria-label={`Screenshots, ${position}`}
        aria-haspopup="dialog"
        onClick={onShots}
      >
        {position}
      </Button>
      <Button
        className={styles.comments}
        leading={<ReviewIcon size={18} />}
        aria-label={`Comments, ${comments}`}
        aria-haspopup="dialog"
        onClick={onComments}
      >
        {comments > 0 ? <Badge>{comments}</Badge> : null}
      </Button>
      {reviewable && review.canReject ? (
        <Button
          className={styles.decision}
          variant="danger"
          leading={<CancelIcon />}
          disabled={review.pending}
          onClick={review.askReject}
        >
          Reject
        </Button>
      ) : null}
      {reviewable && review.canApprove ? (
        <Button
          className={styles.decision}
          variant="primary"
          leading={<TaskDoneIcon />}
          disabled={review.pending}
          onClick={review.approve}
        >
          Approve
        </Button>
      ) : null}
      <RejectDialog
        open={review.rejecting}
        subject={review.rejectName ?? snapshotName ?? 'this screenshot'}
        pending={review.pending}
        reasonRequired={review.reasonRequired}
        onCancel={review.cancelReject}
        onReject={review.confirmReject}
      />
    </div>
  )
}

export namespace PhoneReviewBar {
  export interface Props {
    review: ReviewControls
    /** The build can be decided on (finished, with changes). */
    reviewable: boolean
    snapshotName: string | undefined
    /** "3 / 12": which screenshot of how many. */
    position: string
    comments: number
    onShots: () => void
    onComments: () => void
  }
}

/**
 * The More sheet of the build page on a phone: what the keyboard has that the bar leaves out.
 * `children` are the rows (Approve all, Request review, Copy link).
 */
export function PhoneBuildMore({ open, onOpenChange, children }: PhoneBuildMore.Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="More actions">
      <div className={styles.more}>{children}</div>
    </Sheet>
  )
}

export namespace PhoneBuildMore {
  export interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    children: ReactNode
  }
}

/** A row of the build More sheet: an icon, a label, 48px tall, the full width. */
export function MoreAction({ icon, children, ...rest }: MoreAction.Props) {
  return (
    <Button variant="ghost" className={styles.action} leading={icon} {...rest}>
      {children}
    </Button>
  )
}

export namespace MoreAction {
  export interface Props extends Omit<Button.Props, 'variant' | 'size' | 'leading' | 'className'> {
    icon: ReactNode
  }
}
