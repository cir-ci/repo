import type { FormEvent, ReactNode } from 'react'
import { useId } from 'react'

import { Button } from './Button.tsx'
import { Dialog } from './Dialog.tsx'

/**
 * A `Dialog` around one form: Cancel and a submit button in the footer, wired to the form with
 * `form={id}` (the buttons sit outside the `<form>` element). It stops the browser's own submit,
 * then calls `onSubmit` with the event. `onClose` runs when the dialog is dismissed (Escape, the
 * close button, the backdrop) and when Cancel is pressed, unless `onCancel` is given for Cancel.
 * `pending` shows the submit button as loading.
 */
export function FormDialog({
  onClose,
  onCancel,
  onSubmit,
  pending = false,
  submitLabel,
  submitVariant = 'primary',
  submitDisabled,
  cancelVariant = 'secondary',
  formClassName,
  noValidate,
  children,
  ...rest
}: FormDialog.Props) {
  const formId = `${useId()}-form`
  return (
    <Dialog
      {...rest}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      actions={
        <>
          <Button type="button" variant={cancelVariant} onClick={onCancel ?? onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={submitVariant}
            loading={pending}
            {...(submitDisabled === undefined ? {} : { disabled: submitDisabled })}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className={formClassName}
        noValidate={noValidate}
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(event)
        }}
      >
        {children}
      </form>
    </Dialog>
  )
}

export namespace FormDialog {
  export interface Props extends Omit<Dialog.Props, 'actions' | 'onOpenChange' | 'children'> {
    /** Dismissal, and Cancel unless `onCancel` is set. */
    onClose: () => void
    onCancel?: (() => void) | undefined
    /** Runs after the browser's own submit is stopped. */
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
    pending?: boolean
    submitLabel: ReactNode
    submitVariant?: Button.Props['variant']
    submitDisabled?: boolean | undefined
    cancelVariant?: Button.Props['variant']
    formClassName?: string | undefined
    noValidate?: boolean | undefined
    children?: ReactNode
  }
}
