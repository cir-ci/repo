import type { Project, Workspace } from '@circi/api'
import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { projectPath, workspacePath } from '#lib/api-paths.ts'
import { getJson, post, send } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'

/** Who is in the project (`GET /api/projects/:workspace/:project/members`). */
export const projectMembersQuery = (workspace: string, project: string) =>
  queryOptions({
    queryKey: keys.projectMembers(workspace, project),
    queryFn: () => getJson<Project.MemberList>(projectPath(workspace, project, 'members')),
  })

/** The projects each member of the workspace is in, by user ID. */
export const memberProjectsQuery = (workspace: string) =>
  queryOptions({
    queryKey: keys.memberProjects(workspace),
    queryFn: () => getJson<Workspace.MemberProjects>(workspacePath(workspace, 'member-projects')),
  })

/** What a change of membership makes stale: the member lists, the project lists and the sidebar. */
const refreshAfterMembership = (queryClient: QueryClient, workspace: string, project: string) =>
  invalidateAll(
    queryClient,
    keys.projectMembers(workspace, project),
    keys.memberProjects(workspace),
    keys.projects(),
    keys.sidebar(),
  )

/** Adds workspace members to the project (`POST …/members`, `{ userIds }`). */
export function useAddProjectMembers(workspace: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'add the members' },
    mutationFn: (userIds: string[]) =>
      post<Project.MemberList>(projectPath(workspace, project, 'members'), { userIds }),
    onSuccess: () => refreshAfterMembership(queryClient, workspace, project),
  })
}

/** Takes a person out of the project (`DELETE …/members/:userId`); leaving is your own ID. */
export function useRemoveProjectMember(workspace: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'remove the member' },
    mutationFn: (userId: string) =>
      send<undefined>('DELETE', projectPath(workspace, project, 'members', userId)),
    onSuccess: () => refreshAfterMembership(queryClient, workspace, project),
  })
}
