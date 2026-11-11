import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'

import { switchWorkspacePath, type WorkspaceRef } from '#app/shell-model.ts'
import { projectsQuery } from '#features/projects/api/index.ts'
import { useWorkspaceStore } from '#lib/stores/workspace-store.ts'

/**
 * Switches to another workspace: remembers the choice and opens the same page there; a project page
 * goes to the workspace's first project. Shared by the sidebar's switcher and the phone's More sheet.
 */
export function useSwitchWorkspace(): (next: WorkspaceRef) => void {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const choose = useWorkspaceStore((s) => s.choose)
  const { data: overview } = useQuery(projectsQuery())
  return (next) => {
    choose(next.slug)
    const target = switchWorkspacePath(pathname, next.slug, (slug) => {
      const slugs = (overview?.projects ?? [])
        .filter((o) => o.workspace.slug === slug)
        .map((o) => o.project.slug)
      return slugs[0]
    })
    if (target) void navigate({ href: target })
  }
}
