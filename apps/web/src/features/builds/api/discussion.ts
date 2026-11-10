import type { Activity, Comment, Review } from '@circi/api'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { workspaceQuery } from '#features/members/api.ts'
import { teamPath } from '#lib/api-paths.ts'
import { getJson, post, send } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'

import type { Mention } from '../mentions.ts'

/** The workspace's members as @mention candidates (empty while they load). */
export function useMentionMembers(workspace: string): Mention.Member[] {
  const { data } = useQuery(workspaceQuery(workspace))
  return (data?.members ?? []).map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
  }))
}

export const commentsQuery = (workspace: string, team: string, number: number) =>
  queryOptions({
    queryKey: keys.comments(workspace, team, number),
    queryFn: () => getJson<Comment.List>(teamPath(workspace, team, 'builds', number, 'comments')),
  })

export const activityQuery = (workspace: string, team: string, number: number) =>
  queryOptions({
    queryKey: keys.activity(workspace, team, number),
    queryFn: () =>
      getJson<Activity.Timeline>(teamPath(workspace, team, 'builds', number, 'activity')),
  })

/** A comment changes the thread list, and shows up in the build's activity. */
function useRefreshDiscussion(workspace: string, team: string, number: number) {
  const queryClient = useQueryClient()
  return () =>
    invalidateAll(
      queryClient,
      keys.comments(workspace, team, number),
      keys.activity(workspace, team, number),
    )
}

export function useAddComment(workspace: string, team: string, number: number) {
  const refresh = useRefreshDiscussion(workspace, team, number)
  return useMutation({
    mutationFn: (input: Comment.Create) =>
      post<{ id: string }>(teamPath(workspace, team, 'builds', number, 'comments'), input),
    onSuccess: refresh,
  })
}

export function useEditComment(workspace: string, team: string, number: number) {
  const refresh = useRefreshDiscussion(workspace, team, number)
  return useMutation({
    mutationFn: ({ id, body }: { id: string } & Comment.Edit) =>
      send<{ id: string }>('PATCH', teamPath(workspace, team, 'builds', number, 'comments', id), {
        body,
      }),
    onSuccess: refresh,
  })
}

export function useDeleteComment(workspace: string, team: string, number: number) {
  const refresh = useRefreshDiscussion(workspace, team, number)
  return useMutation({
    mutationFn: (id: string) =>
      send<undefined>('DELETE', teamPath(workspace, team, 'builds', number, 'comments', id)),
    onSuccess: refresh,
  })
}

/** Asks a workspace member to review the build; the activity shows the request. */
export function useRequestReview(workspace: string, team: string, number: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reviewerId: string) =>
      post<Review.Requested>(teamPath(workspace, team, 'builds', number, 'review-requests'), {
        reviewerId,
      }),
    onSuccess: () =>
      invalidateAll(queryClient, keys.activity(workspace, team, number), keys.reviews()),
  })
}
