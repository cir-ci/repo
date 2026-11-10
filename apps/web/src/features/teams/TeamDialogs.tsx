import { useQuery } from '@tanstack/react-query'

import { useWorkspaces } from '#features/sidebar/use-workspaces.ts'
import { capabilitiesQuery } from '#features/teams/api/index.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'

import { NewWorkspaceDialog } from './CreateDialogs.tsx'
import { GithubImportDialog } from './GithubImportDialog.tsx'
import { NewTeamDialog } from './NewTeamDialog.tsx'

/**
 * The New team, Import from GitHub and New workspace dialogs, mounted once for the signed-in app. Their open state is
 * in `useOverlayStore`, so the sidebar's "+", the team switcher, the Teams page and its empty state
 * all open the same dialog: `useOverlayStore((s) => s.setNewTeamOpen)(true)`.
 */
export function TeamDialogs() {
  const { data: caps } = useQuery(capabilitiesQuery())
  const { workspace } = useWorkspaces(useChosenWorkspace())
  const teamOpen = useOverlayStore((s) => s.newTeamOpen)
  const workspaceOpen = useOverlayStore((s) => s.newWorkspaceOpen)
  const importWorkspace = useOverlayStore((s) => s.importWorkspace)
  const setTeamOpen = useOverlayStore((s) => s.setNewTeamOpen)
  const setImportWorkspace = useOverlayStore((s) => s.setImportWorkspace)
  const setWorkspaceOpen = useOverlayStore((s) => s.setNewWorkspaceOpen)
  return (
    <>
      <NewTeamDialog
        open={teamOpen}
        onClose={() => setTeamOpen(false)}
        workspaces={caps?.manageableWorkspaces ?? []}
        initialWorkspace={workspace?.slug}
      />
      <GithubImportDialog
        open={importWorkspace !== null}
        onClose={() => setImportWorkspace(null)}
        workspace={importWorkspace ?? ''}
      />
      <NewWorkspaceDialog open={workspaceOpen} onClose={() => setWorkspaceOpen(false)} />
    </>
  )
}
