import { FormDialog, TextField } from '@circi/ui'
import { useState } from 'react'

import {
  fieldValue,
  FILTER_FIELDS,
  type BuildFilters,
} from '#features/builds/list/builds-filters.ts'

/** Names the filters of the list and saves them as a view (shown under "Your views"). */
export function SaveViewDialog({
  open,
  filters,
  pending,
  error,
  onCancel,
  onSave,
}: SaveViewDialog.Props) {
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const trimmed = name.trim()
  const summary = FILTER_FIELDS.flatMap(({ field, label }) => {
    const value = fieldValue(field, filters)
    return value ? [`${label}: ${value}`] : []
  }).join(', ')

  function submit() {
    if (pending) return
    if (trimmed === '') {
      setTouched(true)
      return
    }
    onSave(trimmed)
  }

  return (
    <FormDialog
      open={open}
      onClose={() => {
        setName('')
        setTouched(false)
        onCancel()
      }}
      onCancel={onCancel}
      onSubmit={submit}
      title="Save view"
      description={summary}
      submitLabel="Save view"
      pending={pending}
    >
      <TextField
        label="Name"
        value={name}
        maxLength={80}
        autoFocus
        required
        error={error ?? (touched && trimmed === '' ? 'Give the view a name.' : undefined)}
        onChange={(e) => setName(e.target.value)}
      />
    </FormDialog>
  )
}

export namespace SaveViewDialog {
  export interface Props {
    open: boolean
    filters: BuildFilters
    pending: boolean
    /** The server's refusal, shown under the field. */
    error?: string | undefined
    onCancel: () => void
    onSave: (name: string) => void
  }
}
