import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { listWorkspaces, type WorkspaceRef, pickWorkspace } from '#app/shell-model.ts'
import { capabilitiesQuery, teamsQuery } from '#features/teams/api/index.ts'

/** The workspaces the person can switch between, and the one the shell is about (address, else `remembered`, else first). */
export function useWorkspaces(remembered: string | undefined): {
  workspaces: WorkspaceRef[]
  workspace: WorkspaceRef | undefined
} {
  const params = useParams({ strict: false })
  const { data: overview } = useQuery(teamsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const workspaces = listWorkspaces(overview?.teams, caps?.manageableWorkspaces, params.workspace)
  return { workspaces, workspace: pickWorkspace(workspaces, params.workspace, remembered) }
}
