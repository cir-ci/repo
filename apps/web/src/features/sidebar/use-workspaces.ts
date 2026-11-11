import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

import {
  listWorkspaces,
  type WorkspaceRef,
  pickWorkspace,
  rememberWorkspace,
  workspaceToRemember,
} from '#app/shell-model.ts'
import {
  capabilitiesQuery,
  projectsQuery,
  useRememberWorkspace,
} from '#features/projects/api/index.ts'

/** The workspaces the person can switch between, and the one the shell is about (address, else `remembered`, else first). */
export function useWorkspaces(remembered: string | undefined): {
  workspaces: WorkspaceRef[]
  workspace: WorkspaceRef | undefined
} {
  const params = useParams({ strict: false })
  const { data: overview } = useQuery(projectsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const workspaces = listWorkspaces(
    overview?.projects,
    caps?.manageableWorkspaces,
    params.workspace,
  )
  return { workspaces, workspace: pickWorkspace(workspaces, params.workspace, remembered) }
}

/**
 * Writes the workspace in the address to the account when it is one the person belongs to and
 * differs from what the server remembers: once per change, never for an address nobody lists.
 * Mounted once for the signed-in app.
 */
export function useRememberOpenedWorkspace(): void {
  const params = useParams({ strict: false })
  const { data: overview } = useQuery(projectsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const remember = useRememberWorkspace()
  const sent = useRef<string | undefined>(undefined)
  // Only real memberships count: no address is passed, so an unknown one isn't made up.
  const known = listWorkspaces(overview?.projects, caps?.manageableWorkspaces)
  const slug = caps ? workspaceToRemember(params.workspace, known, caps.lastWorkspace) : undefined
  useEffect(() => {
    if (!slug || sent.current === slug) return
    sent.current = slug
    rememberWorkspace(slug)
    remember.mutate(slug)
    // `remember` is a new object every render; the slug is the change.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])
}
