import type { Workspace } from '@circi/api'
import { Banner, Button, Dialog, Ref, Select, Text, TextField, useAnnounce } from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { useCreateWorkspace, useCreateTeam } from './api.ts'

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

export function NewTeamDialog(props: NewTeamDialog.Props) {
  const create = useCreateTeam()
  const navigate = useNavigate()
  const [created, setCreated] = useState<{ workspace: string; slug: string; token: string } | null>(
    null,
  )
  const [pickedWorkspace, setPickedWorkspace] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const workspace = pickedWorkspace ?? props.workspaces[0]?.slug ?? ''

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const name = field(new FormData(e.currentTarget), 'name')
    if (!name) {
      setNameError('Enter a name')
      return
    }
    setNameError(null)
    create.mutate(
      { workspace, name },
      {
        onSuccess: (result) =>
          setCreated({ workspace, slug: result.team.slug, token: result.token }),
      },
    )
  }

  function close() {
    const next = created
    setCreated(null)
    setNameError(null)
    setPickedWorkspace(null)
    create.reset()
    props.onClose()
    if (next)
      void navigate({
        to: '/$workspace/$team',
        params: { workspace: next.workspace, team: next.slug },
      })
  }

  if (created) {
    // The token is shown once, so the dialog can't be dismissed by accident.
    return (
      <Dialog
        open={props.open}
        onOpenChange={() => {}}
        title="Team created"
        hideClose
        dismissible={false}
        actions={
          <Button variant="primary" onClick={close}>
            I’ve saved it
          </Button>
        }
      >
        <div className={styles.form}>
          <Banner tone="warning">
            Copy this CI token now: it isn’t shown again. Put it in your CI secrets as{' '}
            <Text as="code" variant="mono">
              CIRCI_TOKEN
            </Text>
            .
          </Banner>
          <SecretBox label="CI token" value={created.token} />
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title="New team"
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="new-team" variant="primary" loading={create.isPending}>
            Create
          </Button>
        </>
      }
    >
      <form id="new-team" onSubmit={submit} noValidate className={styles.form}>
        <Select
          name="workspace"
          label="Workspace"
          required
          items={props.workspaces.map((o) => ({ value: o.slug, label: o.name }))}
          value={workspace}
          onValueChange={setPickedWorkspace}
        />
        <TextField
          name="name"
          label="Name"
          required
          autoFocus
          description="Usually the repository’s name."
          error={nameError}
        />
        {create.error ? <Banner tone="danger">{create.error.message}</Banner> : null}
      </form>
    </Dialog>
  )
}

export namespace NewTeamDialog {
  export interface Props {
    open: boolean
    onClose: () => void
    workspaces: Workspace.Capabilities['manageableWorkspaces']
  }
}
