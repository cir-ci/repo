import { Banner, Button, Dialog, TextField } from '@circi/ui'
import { type FormEvent, useState } from 'react'

import {
  slugPreview,
  useCreateWorkspace,
  type WorkspaceDraft,
  workspaceProblems,
} from './api/admin.ts'

import styles from './Admin.module.css'

const emptyDraft = (): WorkspaceDraft => ({ name: '', ownerEmail: '' })

/** Creates a workspace for an existing account (instance admins): its name and its owner's email. */
export function CreateWorkspaceDialog({ open, onClose, onCreated }: CreateWorkspaceDialog.Props) {
  const create = useCreateWorkspace()
  const [draft, setDraft] = useState<WorkspaceDraft>(emptyDraft)
  const [shown, setShown] = useState(false)
  const problems = workspaceProblems(draft)
  const slug = slugPreview(draft.name)

  function close() {
    setDraft(emptyDraft())
    setShown(false)
    create.reset()
    onClose()
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setShown(true)
    if (Object.keys(problems).length > 0) return
    create.mutate(draft, {
      onSuccess: ({ workspace }) => {
        setDraft(emptyDraft())
        setShown(false)
        onCreated(workspace.name)
      },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title="Create workspace"
      actions={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            type="submit"
            form="create-workspace"
            variant="primary"
            loading={create.isPending}
          >
            Create workspace
          </Button>
        </>
      }
    >
      <form id="create-workspace" onSubmit={submit} noValidate className={styles.fields}>
        <TextField
          label="Name"
          value={draft.name}
          error={shown ? problems.name : undefined}
          description={slug ? `Address: ${slug}` : undefined}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          autoComplete="off"
        />
        <TextField
          label="Owner's email"
          type="email"
          value={draft.ownerEmail}
          error={shown ? problems.ownerEmail : undefined}
          description="Must already have an account. They can invite the rest."
          onChange={(e) => setDraft({ ...draft, ownerEmail: e.target.value })}
          autoComplete="off"
        />
        {create.error ? <Banner tone="danger">{create.error.message}</Banner> : null}
      </form>
    </Dialog>
  )
}

export namespace CreateWorkspaceDialog {
  export interface Props {
    open: boolean
    onClose: () => void
    /** Called with the new workspace's name. */
    onCreated: (name: string) => void
  }
}
