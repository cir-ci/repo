import type { Org } from '@circi/api'
import { Banner, Button, Dialog, Ref, Select, Text, TextField, useAnnounce } from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { useCreateOrganization, useCreateProject } from './api.ts'

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

export function NewOrganizationDialog({ open, onClose }: NewOrganizationDialog.Props) {
  const create = useCreateOrganization()
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
        announce(`Organization ${name} created`)
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
      title="New organization"
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-organization"
            variant="primary"
            loading={create.isPending}
          >
            Create
          </Button>
        </>
      }
    >
      <form id="new-organization" onSubmit={submit} noValidate className={styles.form}>
        <TextField name="name" label="Name" required autoFocus error={nameError} />
        {create.error ? <Banner tone="danger">{create.error.message}</Banner> : null}
      </form>
    </Dialog>
  )
}

export namespace NewOrganizationDialog {
  export interface Props {
    open: boolean
    onClose: () => void
  }
}

export function NewProjectDialog(props: NewProjectDialog.Props) {
  const create = useCreateProject()
  const navigate = useNavigate()
  const [created, setCreated] = useState<{ org: string; slug: string; token: string } | null>(null)
  const [pickedOrg, setPickedOrg] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const org = pickedOrg ?? props.organizations[0]?.slug ?? ''

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const name = field(new FormData(e.currentTarget), 'name')
    if (!name) {
      setNameError('Enter a name')
      return
    }
    setNameError(null)
    create.mutate(
      { org, name },
      {
        onSuccess: (result) => setCreated({ org, slug: result.project.slug, token: result.token }),
      },
    )
  }

  function close() {
    const next = created
    setCreated(null)
    setNameError(null)
    setPickedOrg(null)
    create.reset()
    props.onClose()
    if (next) void navigate({ to: '/$org/$project', params: { org: next.org, project: next.slug } })
  }

  if (created) {
    // The token is shown once, so the dialog can't be dismissed by accident.
    return (
      <Dialog
        open={props.open}
        onOpenChange={() => {}}
        title="Project created"
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
      title="New project"
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="new-project" variant="primary" loading={create.isPending}>
            Create
          </Button>
        </>
      }
    >
      <form id="new-project" onSubmit={submit} noValidate className={styles.form}>
        <Select
          name="org"
          label="Organization"
          required
          items={props.organizations.map((o) => ({ value: o.slug, label: o.name }))}
          value={org}
          onValueChange={setPickedOrg}
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

export namespace NewProjectDialog {
  export interface Props {
    open: boolean
    onClose: () => void
    organizations: Org.Capabilities['manageableOrganizations']
  }
}
