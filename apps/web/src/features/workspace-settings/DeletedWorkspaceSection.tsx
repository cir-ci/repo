import type { InstanceAdmin } from '@circi/api'
import { Banner, Button, ConfirmDialog, SettingsRow, SettingsSection } from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import {
  deletedLabel,
  usePurgeWorkspace,
  useRestoreWorkspace,
} from '#features/instance/api/admin.ts'
import { toast } from '#lib/toast.ts'

/**
 * What an instance admin can do with a workspace an owner deleted: bring it back with everything
 * in it, or delete it for good now instead of waiting for the 30 days to pass. It is shown in
 * place of the workspace's settings rows, which don't open while it is deleted.
 */
export function DeletedWorkspaceSection({ workspace }: DeletedWorkspaceSection.Props) {
  const navigate = useNavigate()
  const restore = useRestoreWorkspace()
  const purge = usePurgeWorkspace()
  const [purging, setPurging] = useState(false)
  return (
    <>
      {restore.error ? <Banner tone="danger">{restore.error.message}</Banner> : null}
      <SettingsSection title={deletedLabel(workspace.daysLeft)}>
        <SettingsRow
          label="Restore"
          detail="Brings the workspace back with its teams, builds and settings."
        >
          <Button
            loading={restore.isPending}
            onClick={() =>
              restore.mutate(workspace.id, {
                onSuccess: () => {
                  toast(`Restored ${workspace.name}`)
                },
              })
            }
          >
            Restore
          </Button>
        </SettingsRow>
        <SettingsRow
          label="Delete permanently"
          detail="Deletes its teams, builds, screenshots and settings now, without waiting for the rest of the 30 days."
        >
          <Button variant="danger" onClick={() => setPurging(true)}>
            Delete permanently
          </Button>
        </SettingsRow>
      </SettingsSection>
      <ConfirmDialog
        open={purging}
        onOpenChange={setPurging}
        title={`Delete ${workspace.name} permanently?`}
        description="Its teams, builds, screenshots and settings are deleted now, without waiting for the rest of the 30 days. This can't be undone."
        confirmLabel="Delete permanently"
        confirmText={workspace.slug}
        loading={purge.isPending}
        onConfirm={() =>
          purge.mutate(workspace.id, {
            onSuccess: () => {
              toast(`Deleted ${workspace.name} permanently`)
              setPurging(false)
              // The workspace is gone: its address would be a dead end.
              void navigate({ to: '/instance/workspaces', replace: true })
            },
          })
        }
      />
    </>
  )
}

export namespace DeletedWorkspaceSection {
  export interface Props {
    workspace: Pick<InstanceAdmin.Workspace, 'id' | 'name' | 'slug' | 'daysLeft'>
  }
}
