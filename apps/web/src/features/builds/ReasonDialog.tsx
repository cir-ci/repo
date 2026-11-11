import { FormDialog, TextArea } from '@circi/ui'
import { type ReactNode, useRef, useState } from 'react'

import { isSubmitKey } from '#lib/shortcuts.ts'

import styles from './Discussion.module.css'

/**
 * A dialog that asks why before it acts: a required reason, posted by the caller. Empty is not
 * sent: the field turns invalid once it has been left (or ⌘↵ pressed) empty. ⌘↵ sends from the
 * text field. Used for rejecting one snapshot and rejecting several builds.
 */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  invalidMessage,
  required = true,
  hint,
  pending,
  onCancel,
  onSubmit,
}: ReasonDialog.Props) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const trimmed = reason.trim()
  const invalid = required && touched && trimmed === ''

  function submit() {
    if (pending) return
    if (required && trimmed === '') {
      setTouched(true)
      return
    }
    onSubmit(trimmed)
  }

  function reset() {
    setReason('')
    setTouched(false)
    onCancel()
  }

  return (
    <FormDialog
      open={open}
      onClose={reset}
      onCancel={onCancel}
      onSubmit={submit}
      title={title}
      description={description}
      submitLabel={confirmLabel}
      submitVariant="danger"
      pending={pending}
      initialFocus={field}
      formClassName={styles.form}
    >
      <TextArea
        label={required ? 'Reason' : 'Reason (optional)'}
        inputRef={field}
        value={reason}
        rows={4}
        aria-required={required ? true : undefined}
        error={invalid ? invalidMessage : undefined}
        description={hint}
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
    </FormDialog>
  )
}

export namespace ReasonDialog {
  export interface Props {
    open: boolean
    title: string
    description: string
    /** The submit button's name: "Reject". */
    confirmLabel: string
    /** Shown when the reason is empty after the field was touched. */
    invalidMessage: string
    /** Whether the reason must be filled in (default); a project can make it optional. */
    required?: boolean
    /** Shown under the field while it is valid (the shortcut, for example). */
    hint?: ReactNode
    pending: boolean
    onCancel: () => void
    /** Called with the trimmed reason (empty only when it is optional). */
    onSubmit: (reason: string) => void
  }
}
