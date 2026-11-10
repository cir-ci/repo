import {
  Banner,
  Button,
  Dialog,
  SettingsRow,
  SettingsSection,
  Text,
  TextField,
  useAnnounce,
} from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { useDeleteWorkspace } from './api.ts'
import { slugConfirmed } from './model.ts'

import styles from './Settings.module.css'

/**
 * The danger zone of Workspace General: deleting the workspace, after typing its address (slug)
 * back. Owners only. It is hidden at once and purged after 30 days; an instance admin can restore
 * it until then.
 */
export function DeleteWorkspaceSection({ workspace, name, isOwner }: DeleteWorkspaceSection.Props) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const remove = useDeleteWorkspace(workspace)
  const navigate = useNavigate()
  const announce = useAnnounce()

  function close(next: boolean) {
    setOpen(next)
    if (!next) {
      setTyped('')
      remove.reset()
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!slugConfirmed(typed, workspace)) return
    remove.mutate(typed.trim(), {
      onSuccess: () => {
        setOpen(false)
        announce(`Deleted ${name}`)
        void navigate({ to: '/' })
      },
    })
  }

  return (
    <>
      <SettingsSection title="Danger zone" tone="danger">
        <SettingsRow
          label="Delete workspace"
          detail={
            <>
              Hides {name} for everyone at once: its teams, builds, hosted sites and CI tokens stop
              working. Everything is deleted for good after 30 days; until then whoever runs this
              server can restore it. You’ll type <Text variant="mono">{workspace}</Text> to confirm.
            </>
          }
        >
          <Button variant="danger" disabled={!isOwner} onClick={() => setOpen(true)}>
            Delete workspace
          </Button>
        </SettingsRow>
      </SettingsSection>
      <Dialog
        open={open}
        onOpenChange={close}
        title={`Delete ${name}?`}
        description="Its teams, builds, screenshots and settings disappear for everyone now, and are deleted for good in 30 days."
        actions={
          <>
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button
              type="submit"
              form="delete-workspace"
              variant="danger"
              loading={remove.isPending}
              disabled={!slugConfirmed(typed, workspace)}
            >
              Delete workspace
            </Button>
          </>
        }
      >
        <form id="delete-workspace" onSubmit={submit} noValidate className={styles.fields}>
          <TextField
            label={`Type ${workspace} to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {remove.error ? <Banner tone="danger">{remove.error.message}</Banner> : null}
        </form>
      </Dialog>
    </>
  )
}

export namespace DeleteWorkspaceSection {
  export interface Props {
    /** The address slug: what is typed to confirm. */
    workspace: string
    name: string
    isOwner: boolean
  }
}
