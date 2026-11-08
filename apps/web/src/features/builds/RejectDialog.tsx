import { Button, Dialog, Kbd, Text } from '@circi/ui'
import { type FormEvent, useId, useState } from 'react'

import { isSubmitKey } from '#lib/shortcuts.ts'

import styles from './Discussion.module.css'

/**
 * Rejecting holds back the merge, so it asks why: the reason is required, is posted with the
 * review and is shown to the author in the activity. ⌘↵ sends it from the text field.
 */
export function RejectDialog({
  open,
  buildNumber,
  pending,
  onCancel,
  onReject,
}: RejectDialog.Props) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const fieldId = useId()
  const errorId = `${fieldId}-error`
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
      title={`Reject build #${buildNumber}?`}
      description="The build is marked rejected and stays that way until someone approves it. Later builds are not compared with it."
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
        <label htmlFor={fieldId} className={styles.label}>
          <Text variant="small">Reason</Text>
        </label>
        <textarea
          id={fieldId}
          className={styles.textarea}
          value={reason}
          rows={4}
          aria-required="true"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? errorId : undefined}
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
          <Text id={errorId} variant="small" tone="rejected" role="alert">
            Say why you are rejecting it.
          </Text>
        ) : (
          <Text variant="small" tone="secondary">
            <Kbd>⌘</Kbd> <Kbd>↵</Kbd> to reject
          </Text>
        )}
      </form>
    </Dialog>
  )
}

export namespace RejectDialog {
  export interface Props {
    open: boolean
    buildNumber: number
    pending: boolean
    onCancel: () => void
    onReject: (reason: string) => void
  }
}
