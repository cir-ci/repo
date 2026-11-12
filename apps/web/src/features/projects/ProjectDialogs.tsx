import { useQuery } from '@tanstack/react-query'

import { capabilitiesQuery } from '#features/projects/api/index.ts'
import { useWorkspaces } from '#features/sidebar/use-workspaces.ts'
import { onDemand } from '#lib/on-demand.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'

const NewWorkspaceDialog = onDemand(
  () => import('./CreateDialogs.tsx'),
  (m) => m.NewWorkspaceDialog,
)
const GithubImportDialog = onDemand(
  () => import('./GithubImportDialog.tsx'),
  (m) => m.GithubImportDialog,
)
const NewProjectDialog = onDemand(
  () => import('./NewProjectDialog.tsx'),
  (m) => m.NewProjectDialog,
)

/**
 * The New project, Import from GitHub and New workspace dialogs, mounted once for the signed-in app. Their open state is
 * in `useOverlayStore`, so the sidebar's "+", the project switcher, the Projects page and its empty state
 * all open the same dialog: `useOverlayStore((s) => s.setNewProjectOpen)(true)`.
 */
export function ProjectDialogs() {
  const { data: caps } = useQuery(capabilitiesQuery())
  const { workspace } = useWorkspaces(useChosenWorkspace())
  const projectOpen = useOverlayStore((s) => s.newProjectOpen)
  const workspaceOpen = useOverlayStore((s) => s.newWorkspaceOpen)
  const importWorkspace = useOverlayStore((s) => s.importWorkspace)
  const setProjectOpen = useOverlayStore((s) => s.setNewProjectOpen)
  const setImportWorkspace = useOverlayStore((s) => s.setImportWorkspace)
  const setWorkspaceOpen = useOverlayStore((s) => s.setNewWorkspaceOpen)
  return (
    <>
      <NewProjectDialog
        open={projectOpen}
        onClose={() => setProjectOpen(false)}
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
