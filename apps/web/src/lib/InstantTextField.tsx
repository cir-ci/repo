import { TextField } from '@circi/ui'
import { type KeyboardEvent, useState } from 'react'

import { SaveNote } from './SaveNote.tsx'

import styles from './InstantTextField.module.css'

/**
 * A text field for a setting that saves by itself (a display name): on blur and on Enter, never
 * while typing. Escape puts the saved text back. Shows "Saved" or the failure under the field.
 * `validate` runs before anything is sent; its message shows on the field.
 */
export function InstantTextField({
  saved,
  onCommit,
  validate,
  mutation,
  label,
  ...field
}: InstantTextField.Props) {
  const [draft, setDraft] = useState(saved)
  const [seen, setSeen] = useState(saved)
  const [problem, setProblem] = useState<string | null>(null)
  // A new saved value (a refetch, a save from elsewhere) replaces the draft.
  if (saved !== seen) {
    setSeen(saved)
    setDraft(saved)
  }

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
    }
  }

  return (
    <div className={styles.root}>
      <TextField
        {...field}
        label={label}
        value={draft}
        error={problem}
        onChange={(e) => {
          setDraft(e.target.value)
          setProblem(null)
          if (mutation.status !== 'idle') mutation.reset()
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <div className={styles.note}>
        <SaveNote mutation={mutation} />
      </div>
    </div>
  )
}

export namespace InstantTextField {
  export interface Props extends Omit<
    TextField.Props,
    'value' | 'defaultValue' | 'onChange' | 'onBlur' | 'onKeyDown' | 'error' | 'invalid'
  > {
    /** The value that is saved now. */
    saved: string
    /** Save this (trimmed, changed, valid) text. */
    onCommit: (next: string) => void
    /** The message for text that must not be sent, or null. */
    validate?: (next: string) => string | null
    mutation: SaveNote.Props['mutation'] & { reset: () => void }
  }
}
