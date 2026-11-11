import { CheckIcon, IconButton, TextField } from '@circi/ui'
import { type KeyboardEvent, type ReactNode, useState } from 'react'

import styles from './CheckedTextField.module.css'

/**
 * A text field for a setting you confirm with a small ✓ beside it (a display name, a URL slug): the
 * ✓ appears only while the text differs from what is saved, and saves it; Enter does the same and
 * Escape puts the saved text back. Nothing is sent while typing or on leaving the field, so a half
 * edit is never saved by accident. `validate` runs before anything is sent; its message shows on
 * the field, and so does a failed save.
 */
export function CheckedTextField({
  saved,
  onCommit,
  validate,
  mutation,
  label,
  description,
  dirtyDescription,
  className,
  ...field
}: CheckedTextField.Props) {
  const [draft, setDraft] = useState(saved)
  const [seen, setSeen] = useState(saved)
  const [problem, setProblem] = useState<string | null>(null)
  // A new saved value (a refetch, a save from elsewhere) replaces the draft.
  if (saved !== seen) {
    setSeen(saved)
    setDraft(saved)
  }
  const dirty = draft.trim() !== saved

  function commit() {
    const next = draft.trim()
    if (next === saved) {
      setDraft(saved)
      setProblem(null)
      return
    }
    const refused = validate?.(next) ?? null
    setProblem(refused)
    if (refused) return
    onCommit(next)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      setDraft(saved)
      setProblem(null)
      if (mutation.error) mutation.reset()
    }
  }

  return (
    <div className={className ? `${styles.root} ${className}` : styles.root}>
      <TextField
        {...field}
        label={label}
        stacked
        value={draft}
        error={problem ?? mutation.error?.message}
        description={dirty && dirtyDescription ? dirtyDescription : description}
        onChange={(e) => {
          setDraft(e.target.value)
          setProblem(null)
          if (mutation.error) mutation.reset()
        }}
        onKeyDown={onKeyDown}
      />
      <span className={styles.slot}>
        {dirty && !field.disabled ? (
          <IconButton
            label={`Save ${label}`}
            title={`Save ${label}`}
            disabled={mutation.isPending}
            onClick={commit}
          >
            <CheckIcon size={16} />
          </IconButton>
        ) : null}
      </span>
    </div>
  )
}

export namespace CheckedTextField {
  export interface Props extends Omit<
    TextField.Props,
    | 'label'
    | 'value'
    | 'defaultValue'
    | 'onChange'
    | 'onBlur'
    | 'onKeyDown'
    | 'error'
    | 'invalid'
    | 'stacked'
    | 'description'
  > {
    /** Shown above the field, and in the ✓ button's name. */
    label: string
    /** The value that is saved now. */
    saved: string
    /** Save this (trimmed, changed, valid) text. */
    onCommit: (next: string) => void
    /** The message for text that must not be sent, or null. */
    validate?: (next: string) => string | null
    /** The save in flight (`useMutation`'s result): the ✓ waits while it runs; its failure shows on the field. */
    mutation: { isPending: boolean; error: Error | null; reset: () => void }
    /** Help under the field. */
    description?: ReactNode
    /** In its place while the text differs from what is saved (a warning about the change). */
    dirtyDescription?: ReactNode
  }
}
