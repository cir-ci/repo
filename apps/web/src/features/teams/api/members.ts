import type { Team, Workspace } from '@circi/api'
import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { teamPath, workspacePath } from '#lib/api-paths.ts'
import { getJson, post, send } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'

/** Who is in the team (`GET /api/teams/:workspace/:team/members`). */
export const teamMembersQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: keys.teamMembers(workspace, team),
    queryFn: () => getJson<Team.MemberList>(teamPath(workspace, team, 'members')),
  })

/** The teams each member of the workspace is in, by user ID. */
export const memberTeamsQuery = (workspace: string) =>
  queryOptions({
    queryKey: keys.memberTeams(workspace),
    queryFn: () => getJson<Workspace.MemberTeams>(workspacePath(workspace, 'member-teams')),
  })

/** What a change of membership makes stale: the member lists, the team lists and the sidebar. */
const refreshAfterMembership = (queryClient: QueryClient, workspace: string, team: string) =>
  invalidateAll(
    queryClient,
    keys.teamMembers(workspace, team),
    keys.memberTeams(workspace),
    keys.teams(),
    keys.sidebar(),
  )

/** Adds workspace members to the team (`POST …/members`, `{ userIds }`). */
export function useAddTeamMembers(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'add the members' },
    mutationFn: (userIds: string[]) =>
      post<Team.MemberList>(teamPath(workspace, team, 'members'), { userIds }),
    onSuccess: () => refreshAfterMembership(queryClient, workspace, team),
  })
}

/** Takes a person out of the team (`DELETE …/members/:userId`); leaving is your own ID. */
export function useRemoveTeamMember(workspace: string, team: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'remove the member' },
    mutationFn: (userId: string) =>
      send<undefined>('DELETE', teamPath(workspace, team, 'members', userId)),
    onSuccess: () => refreshAfterMembership(queryClient, workspace, team),
  })
}
