import { Kbd } from '@circi/ui'

import { ReasonDialog } from './ReasonDialog.tsx'

/**
 * Rejecting holds back the merge, so it asks why: the reason is required, is posted with the
 * review and is shown to the author in the activity. ⌘↵ sends it from the text field.
 */
export function RejectDialog({ open, subject, pending, onCancel, onReject }: RejectDialog.Props) {
  return (
    <ReasonDialog
      open={open}
      title={`Reject ${subject}?`}
      description="The snapshot is marked rejected, which holds back the build’s merge until it is approved. It never becomes a baseline."
      confirmLabel="Reject"
      invalidMessage="Say why you are rejecting it."
      hint={
        <>
          <Kbd>⌘</Kbd> <Kbd>↵</Kbd> to reject
        </>
      }
      pending={pending}
      onCancel={onCancel}
      onSubmit={onReject}
    />
  )
}

export namespace RejectDialog {
  export interface Props {
    open: boolean
    /** What is being rejected: the snapshot's name. */
    subject: string
    pending: boolean
    onCancel: () => void
    onReject: (reason: string) => void
  }
}
