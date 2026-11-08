import type { Activity, Comment, Review } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, send, seg } from '../../lib/http.ts'

const base = (org: string, project: string, number: number) =>
  `/api/projects/${seg(org)}/${seg(project)}/builds/${number}`

export const commentsQuery = (org: string, project: string, number: number) =>
  queryOptions({
    queryKey: ['comments', org, project, number],
    queryFn: () => getJson<Comment.List>(`${base(org, project, number)}/comments`),
  })

export const activityQuery = (org: string, project: string, number: number) =>
  queryOptions({
    queryKey: ['activity', org, project, number],
    queryFn: () => getJson<Activity.Timeline>(`${base(org, project, number)}/activity`),
  })

/** A comment changes the thread list, and shows up in the build's activity. */
function useRefreshDiscussion(org: string, project: string, number: number) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['comments', org, project, number] }),
      queryClient.invalidateQueries({ queryKey: ['activity', org, project, number] }),
    ])
}

export function useAddComment(org: string, project: string, number: number) {
  const refresh = useRefreshDiscussion(org, project, number)
  return useMutation({
    mutationFn: (input: Comment.Create) =>
      post<{ id: string }>(`${base(org, project, number)}/comments`, input),
    onSuccess: refresh,
  })
}

export function useEditComment(org: string, project: string, number: number) {
  const refresh = useRefreshDiscussion(org, project, number)
  return useMutation({
    mutationFn: ({ id, body }: { id: string } & Comment.Edit) =>
      send<{ id: string }>('PATCH', `${base(org, project, number)}/comments/${seg(id)}`, { body }),
    onSuccess: refresh,
  })
}

export function useDeleteComment(org: string, project: string, number: number) {
  const refresh = useRefreshDiscussion(org, project, number)
  return useMutation({
    mutationFn: (id: string) =>
      send<undefined>('DELETE', `${base(org, project, number)}/comments/${seg(id)}`),
    onSuccess: refresh,
  })
}

/** Asks an organization member to review the build; the activity shows the request. */
export function useRequestReview(org: string, project: string, number: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reviewerId: string) =>
      post<Review.Requested>(`${base(org, project, number)}/review-requests`, { reviewerId }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['activity', org, project, number] }),
        queryClient.invalidateQueries({ queryKey: ['reviews'] }),
      ]),
  })
}
