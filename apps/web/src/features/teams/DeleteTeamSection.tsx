import {
  Banner,
  Button,
  Dialog,
  SettingsRow,
  SettingsSection,
  TextField,
  useAnnounce,
} from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { useDeleteTeam } from '#features/teams/api/index.ts'

import { deleteConfirmed, deletePhrase } from './delete-team.ts'

import shared from '#features/team-settings/TeamSettings.module.css'

/**
 * The danger zone of Team General: deleting the team, after typing `workspace/team` back. Owners
 * and admins only; anyone else sees why it is disabled.
 */
export function DeleteTeamSection({ workspace, team, name, canManage }: DeleteTeamSection.Props) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const remove = useDeleteTeam(workspace, team)
  const navigate = useNavigate()
  const announce = useAnnounce()
  const phrase = deletePhrase(workspace, team)

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
        announce(`Deleted ${name}`)
        void navigate({ to: '/' })
      },
    })
  }

  return (
    <>
      <SettingsSection title="Danger zone" tone="danger">
        <SettingsRow
          label="Delete team"
          detail={`Deletes ${name} with its builds, screenshots, hosted sites, rules and webhooks, and stops its CI token working. Screenshot files are cleaned up by retention afterwards.`}
        >
          <Button variant="danger" disabled={!canManage} onClick={() => setOpen(true)}>
            Delete team
          </Button>
        </SettingsRow>
      </SettingsSection>
      <Dialog
        open={open}
        onOpenChange={close}
        title={`Delete ${name}?`}
        description="This can't be undone. The team's builds, screenshots, sites and settings are deleted for everyone."
        actions={
          <>
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button
              type="submit"
              form="delete-team"
              variant="danger"
              loading={remove.isPending}
              disabled={!deleteConfirmed(typed, phrase)}
            >
              Delete team
            </Button>
          </>
        }
      >
        <form id="delete-team" onSubmit={submit} noValidate className={shared.stack}>
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

export namespace DeleteTeamSection {
  export interface Props {
    workspace: string
    team: string
    name: string
    canManage: boolean
  }
}
