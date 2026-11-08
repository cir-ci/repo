import { Button, Dialog, TextField } from '@circi/ui'
import { type FormEvent, useId, useState } from 'react'

import { fieldValue, FILTER_FIELDS, type BuildFilters } from '#features/projects/builds-filters.ts'

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
  const formId = useId()
  const trimmed = name.trim()
  const summary = FILTER_FIELDS.flatMap(({ field, label }) => {
    const value = fieldValue(field, filters)
    return value ? [`${label}: ${value}`] : []
  }).join(', ')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    if (trimmed === '') {
      setTouched(true)
      return
    }
    onSave(trimmed)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName('')
          setTouched(false)
          onCancel()
        }
      }}
      title="Save view"
      description={summary}
      actions={
        <>
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={pending}>
            Save view
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit}>
        <TextField
          label="Name"
          value={name}
          maxLength={80}
          autoFocus
          required
          error={error ?? (touched && trimmed === '' ? 'Give the view a name.' : undefined)}
          onChange={(e) => setName(e.target.value)}
        />
      </form>
    </Dialog>
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
