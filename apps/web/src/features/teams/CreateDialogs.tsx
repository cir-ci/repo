import { Banner, FormDialog, TextField, useAnnounce } from '@circi/ui'
import { type FormEvent, useState } from 'react'

import { useCreateWorkspace } from '#features/teams/api/index.ts'

import styles from './CreateDialogs.module.css'

function field(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
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
    <FormDialog
      open={open}
      onClose={close}
      onSubmit={submit}
      title="New workspace"
      submitLabel="Create"
      cancelVariant="ghost"
      pending={create.isPending}
      noValidate
      formClassName={styles.form}
    >
      <TextField name="name" label="Name" required autoFocus error={nameError} />
      {create.error ? <Banner tone="danger">{create.error.message}</Banner> : null}
    </FormDialog>
  )
}

export namespace NewWorkspaceDialog {
  export interface Props {
    open: boolean
    onClose: () => void
  }
}
