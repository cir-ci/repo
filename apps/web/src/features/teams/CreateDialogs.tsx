import { Banner, Button, Dialog, Ref, Text, TextField, useAnnounce } from '@circi/ui'
import { type FormEvent, useState } from 'react'

import { useCreateWorkspace } from '#features/teams/api/index.ts'

import styles from './CreateDialogs.module.css'

function field(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/** A secret shown once, with a way to copy it. */
export function SecretBox({ label, value }: SecretBox.Props) {
  return (
    <div className={styles.secret}>
      <Text variant="small" tone="secondary">
        {label}
      </Text>
      <Ref value={value} label={label} className={styles.secretValue} />
    </div>
  )
}

export namespace SecretBox {
  export interface Props {
    label: string
    value: string
  }
}

export function NewWorkspaceDialog({ open, onClose }: NewWorkspaceDialog.Props) {
  const create = useCreateWorkspace()
  const announce = useAnnounce()
  const [nameError, setNameError] = useState<string | null>(null)

  function close() {
    setNameError(null)
    create.reset()
    onClose()
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const name = field(new FormData(e.currentTarget), 'name')
    if (!name) {
      setNameError('Enter a name')
      return
    }
    setNameError(null)
    create.mutate(name, {
      onSuccess: () => {
        announce(`Workspace ${name} created`)
        close()
      },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title="New workspace"
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="new-workspace" variant="primary" loading={create.isPending}>
            Create
          </Button>
        </>
      }
    >
      <form id="new-workspace" onSubmit={submit} noValidate className={styles.form}>
        <TextField name="name" label="Name" required autoFocus error={nameError} />
        {create.error ? <Banner tone="danger">{create.error.message}</Banner> : null}
      </form>
    </Dialog>
  )
}

export namespace NewWorkspaceDialog {
  export interface Props {
    open: boolean
    onClose: () => void
  }
}
