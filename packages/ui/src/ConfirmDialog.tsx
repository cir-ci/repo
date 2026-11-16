import { AlertDialog } from '@base-ui/react/alert-dialog'
import { type FormEvent, type ReactNode, useRef, useState } from 'react'

import { Button } from './Button.tsx'
import { TextField } from './TextField.tsx'

import styles from './ConfirmDialog.module.css'

/**
 * Provisional: the confirmation for a destructive action, on Base UI's
 * `AlertDialog` (modal, no dismissal by a click outside; Escape cancels). Name the thing in
 * `title`. With `confirmText` (a project's slug, say) the destructive button stays disabled, and
 * Enter does nothing, until the user has typed it exactly.
 *
 * Focus starts on Cancel, or on the phrase field when there is one: Enter never confirms by
 * accident.
 */
export function ConfirmDialog({
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  confirmText,
  loading = false,
  onConfirm,
  ...rest
}: ConfirmDialog.Props) {
  const [typed, setTyped] = useState('')
  const cancel = useRef<HTMLButtonElement>(null)
  const matches = confirmText === undefined || typed === confirmText

  function submit(event: FormEvent) {
    event.preventDefault()
    if (matches && !loading) onConfirm()
  }

  return (
    <AlertDialog.Root
      {...rest}
      onOpenChange={(next, details) => {
        if (!next) setTyped('')
        onOpenChange?.(next, details)
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={styles.backdrop} />
        <AlertDialog.Viewport className={styles.viewport}>
          <AlertDialog.Popup
            className={styles.popup}
            initialFocus={confirmText === undefined ? cancel : true}
          >
            <form onSubmit={submit} className={styles.form}>
              <div className={styles.body}>
                <AlertDialog.Title className={styles.title}>{title}</AlertDialog.Title>
                {description ? (
                  <AlertDialog.Description className={styles.description}>
                    {description}
                  </AlertDialog.Description>
                ) : null}
                {confirmText === undefined ? null : (
                  <TextField
                    label={
                      <>
                        Type <code className={styles.phrase}>{confirmText}</code> to confirm
                      </>
                    }
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
              </div>
              <footer className={styles.footer}>
                <AlertDialog.Close
                  ref={cancel}
                  render={<Button type="button">{cancelLabel}</Button>}
                />
                <Button
                  type="submit"
                  variant="danger"
                  className={styles.confirm}
                  disabled={!matches}
                  loading={loading}
                >
                  {confirmLabel}
                </Button>
              </footer>
            </form>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

export namespace ConfirmDialog {
  export interface Props extends Omit<AlertDialog.Root.Props, 'children'> {
    /** The accessible name; say what is being destroyed ("Delete web-app?"). */
    title: ReactNode
    /** What will happen, and that it can't be undone. */
    description?: ReactNode
    /** The destructive button's label; "Delete" by default. */
    confirmLabel?: string
    cancelLabel?: string
    /** If set, the user must type exactly this before the destructive button works. */
    confirmText?: string
    /** Shows a spinner on the destructive button and ignores it while the action runs. */
    loading?: boolean
    /** Called on the destructive button or on Enter in the phrase field. */
    onConfirm: () => void
  }
}
