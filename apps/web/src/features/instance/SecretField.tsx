import { Badge, Button, TextField } from '@circi/ui'

import type { SecretDraft } from './config-model.ts'

import styles from './Admin.module.css'

/**
 * A write-only secret (a mail password, a client secret): the browser never receives it. When one
 * is saved the field says "Saved" with Replace and Remove; Replace shows an empty input for the
 * new value, Remove marks it for removal when the form is saved. With none saved it is an empty input.
 */
export function SecretField({
  label,
  saved,
  draft,
  onChange,
  error,
  disabled,
  removable = true,
}: SecretField.Props) {
  const typing = draft.mode === 'replace' || (!saved && draft.mode === 'keep')
  if (typing) {
    return (
      <div className={styles.secret}>
        <TextField
          label={saved ? `New ${label.toLowerCase()}` : label}
          type="password"
          autoComplete="new-password"
          value={draft.mode === 'replace' ? draft.value : ''}
          disabled={disabled}
          error={error}
          onChange={(e) => onChange({ mode: 'replace', value: e.target.value })}
        />
        {saved ? (
          <Button variant="ghost" size="sm" onClick={() => onChange({ mode: 'keep' })}>
            Keep the saved one
          </Button>
        ) : null}
      </div>
    )
  }
  return (
    <div className={styles.secret} role="group" aria-label={label}>
      <span className={styles.secretLabel}>{label}</span>
      {draft.mode === 'remove' ? (
        <>
          <Badge shape="tag">Removed when you save</Badge>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onChange({ mode: 'keep' })}
          >
            Keep
          </Button>
        </>
      ) : (
        <>
          <Badge shape="tag" tone="state" state="approved">
            Saved
          </Badge>
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => onChange({ mode: 'replace', value: '' })}
          >
            Replace
          </Button>
          {removable ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onChange({ mode: 'remove' })}
            >
              Remove
            </Button>
          ) : null}
        </>
      )}
    </div>
  )
}

export namespace SecretField {
  export interface Props {
    /** What it is: "Password", "Client secret". */
    label: string
    /** A value is saved on the server. */
    saved: boolean
    draft: SecretDraft
    onChange: (next: SecretDraft) => void
    error?: string | undefined
    disabled?: boolean | undefined
    /** Whether the saved one can be removed on its own (a client secret can't). */
    removable?: boolean
  }
}
