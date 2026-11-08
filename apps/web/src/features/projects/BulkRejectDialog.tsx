import { Button, Dialog, Text } from '@circi/ui'
import { type FormEvent, useId, useState } from 'react'

import { isSubmitKey } from '#lib/shortcuts.ts'

import styles from './BulkRejectDialog.module.css'

/** Rejecting asks why, once for all the selected builds; the reason is posted with each review. */
export function BulkRejectDialog({
  open,
  count,
  pending,
  onCancel,
  onReject,
}: BulkRejectDialog.Props) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const fieldId = useId()
  const trimmed = reason.trim()
  const invalid = touched && trimmed === ''

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (pending) return
    if (trimmed === '') {
      setTouched(true)
      return
    }
    onReject(trimmed)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('')
          setTouched(false)
          onCancel()
        }
      }}
      title={`Reject ${count} ${count === 1 ? 'build' : 'builds'}?`}
      description="They are marked rejected and stay that way until someone approves them."
      actions={
        <>
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" form={`${fieldId}-form`} variant="danger" loading={pending}>
            Reject
          </Button>
        </>
      }
    >
      <form id={`${fieldId}-form`} onSubmit={submit} className={styles.form}>
        <label htmlFor={fieldId}>
          <Text variant="small">Reason</Text>
        </label>
        <textarea
          id={fieldId}
          className={styles.textarea}
          value={reason}
          rows={4}
          aria-required="true"
          aria-invalid={invalid ? true : undefined}
          placeholder="What needs to change?"
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => {
            if (isSubmitKey(e)) {
              e.preventDefault()
              submit()
            }
          }}
        />
        {invalid ? (
          <Text variant="small" tone="rejected" role="alert">
            Say why you are rejecting them.
          </Text>
        ) : null}
      </form>
    </Dialog>
  )
}

export namespace BulkRejectDialog {
  export interface Props {
    open: boolean
    count: number
    pending: boolean
    onCancel: () => void
    onReject: (reason: string) => void
  }
}
