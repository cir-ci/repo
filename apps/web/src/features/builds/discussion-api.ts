import type { Activity, Comment, Review } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, send, seg } from '#lib/http.ts'

const base = (workspace: string, team: string, number: number) =>
  `/api/teams/${seg(workspace)}/${seg(team)}/builds/${number}`

export const commentsQuery = (workspace: string, team: string, number: number) =>
  queryOptions({
    queryKey: ['comments', workspace, team, number],
    queryFn: () => getJson<Comment.List>(`${base(workspace, team, number)}/comments`),
  })

export const activityQuery = (workspace: string, team: string, number: number) =>
  queryOptions({
    queryKey: ['activity', workspace, team, number],
    queryFn: () => getJson<Activity.Timeline>(`${base(workspace, team, number)}/activity`),
  })

/** A comment changes the thread list, and shows up in the build's activity. */
function useRefreshDiscussion(workspace: string, team: string, number: number) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['comments', workspace, team, number] }),
      queryClient.invalidateQueries({ queryKey: ['activity', workspace, team, number] }),
    ])
}

export function useAddComment(workspace: string, team: string, number: number) {
  const refresh = useRefreshDiscussion(workspace, team, number)
  return useMutation({
    mutationFn: (input: Comment.Create) =>
      post<{ id: string }>(`${base(workspace, team, number)}/comments`, input),
    onSuccess: refresh,
  })
}

export function useEditComment(workspace: string, team: string, number: number) {
  const refresh = useRefreshDiscussion(workspace, team, number)
  return useMutation({
    mutationFn: ({ id, body }: { id: string } & Comment.Edit) =>
      send<{ id: string }>('PATCH', `${base(workspace, team, number)}/comments/${seg(id)}`, {
        body,
      }),
    onSuccess: refresh,
  })
}

export function useDeleteComment(workspace: string, team: string, number: number) {
  const refresh = useRefreshDiscussion(workspace, team, number)
  return useMutation({
    mutationFn: (id: string) =>
      send<undefined>('DELETE', `${base(workspace, team, number)}/comments/${seg(id)}`),
    onSuccess: refresh,
  })
}

/** Asks a workspace member to review the build; the activity shows the request. */
export function useRequestReview(workspace: string, team: string, number: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reviewerId: string) =>
      post<Review.Requested>(`${base(workspace, team, number)}/review-requests`, { reviewerId }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['activity', workspace, team, number] }),
        queryClient.invalidateQueries({ queryKey: ['reviews'] }),
      ]),
  })
}
