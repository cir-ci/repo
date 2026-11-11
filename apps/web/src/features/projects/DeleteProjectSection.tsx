import { Banner, Button, Dialog, SettingsRow, SettingsSection, TextField } from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { useDeleteProject } from '#features/projects/api/index.ts'
import { toast } from '#lib/toast.ts'

import { deleteConfirmed, deletePhrase } from './delete-project.ts'

import shared from '#features/project-settings/ProjectSettings.module.css'

/**
 * The danger zone of Project General: deleting the project, after typing `workspace/project` back. Owners
 * and admins only; anyone else sees why it is disabled.
 */
export function DeleteProjectSection({
  workspace,
  project,
  name,
  canManage,
}: DeleteProjectSection.Props) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const remove = useDeleteProject(workspace, project)
  const navigate = useNavigate()
  const phrase = deletePhrase(workspace, project)

  function close(next: boolean) {
    setOpen(next)
    if (!next) {
      setTyped('')
      remove.reset()
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!deleteConfirmed(typed, phrase)) return
    remove.mutate(undefined, {
      onSuccess: () => {
        setOpen(false)
        toast(`Deleted ${name}`)
        void navigate({ to: '/workspaces/$workspace/settings/projects', params: { workspace } })
      },
    })
  }

  return (
    <>
      <SettingsSection title="Danger zone" tone="danger">
        <SettingsRow
          label="Delete project"
          detail={`Deletes ${name} with its builds, screenshots, hosted sites, rules and webhooks, and stops its CI token working. Screenshot files are cleaned up by retention afterwards.`}
        >
          <Button variant="danger" disabled={!canManage} onClick={() => setOpen(true)}>
            Delete project
          </Button>
        </SettingsRow>
      </SettingsSection>
      <Dialog
        open={open}
        onOpenChange={close}
        title={`Delete ${name}?`}
        description="This can't be undone. The project's builds, screenshots, sites and settings are deleted for everyone."
        actions={
          <>
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button
              type="submit"
              form="delete-project"
              variant="danger"
              loading={remove.isPending}
              disabled={!deleteConfirmed(typed, phrase)}
            >
              Delete project
            </Button>
          </>
        }
      >
        <form id="delete-project" onSubmit={submit} noValidate className={shared.stack}>
          <TextField
            label={`Type ${phrase} to confirm`}
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

export namespace DeleteProjectSection {
  export interface Props {
    workspace: string
    project: string
    name: string
    canManage: boolean
  }
}
