import { ReasonDialog } from '#features/builds/ReasonDialog.tsx'

/** Rejecting asks why, once for all the selected builds; the reason is posted with each review. */
export function BulkRejectDialog({
  open,
  count,
  pending,
  reasonRequired,
  onCancel,
  onReject,
}: BulkRejectDialog.Props) {
  return (
    <ReasonDialog
      open={open}
      title={`Reject ${count} ${count === 1 ? 'build' : 'builds'}?`}
      description="They are marked rejected and stay that way until someone approves them."
      confirmLabel="Reject"
      invalidMessage="Say why you are rejecting them."
      required={reasonRequired ?? true}
      pending={pending}
      onCancel={onCancel}
      onSubmit={onReject}
    />
  )
}

export namespace BulkRejectDialog {
  export interface Props {
    open: boolean
    count: number
    pending: boolean
    /** The project asks for a reason (the default until it is known). */
    reasonRequired?: boolean
    onCancel: () => void
    onReject: (reason: string) => void
  }
}
