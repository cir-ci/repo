import type { Build, ReviewState } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, seg } from '../../lib/http.ts'

/** Builds still being uploaded or processed; their pages poll until they finish. */
export const isActive = (status: string) =>
  status === 'pending' || status === 'uploading' || status === 'processing'

export const buildQuery = (org: string, project: string, number: number) =>
  queryOptions({
    queryKey: ['build', org, project, number],
    queryFn: () =>
      getJson<Build.Detail>(`/api/projects/${seg(org)}/${seg(project)}/builds/${number}`),
    refetchInterval: (q) => (q.state.data && isActive(q.state.data.build.status) ? 2_000 : false),
  })

export const fileUrl = (sha256: string) => `/api/files/${sha256}`

/**
 * Approve or reject a build's changes. Afterwards everything that shows the build's state is
 * refetched: its page, the project's builds list and the projects overview.
 */
export function useReviewBuild(org: string, project: string, number: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (state: ReviewState) =>
      post<{ build: { reviewStatus: ReviewState } }>(
        `/api/projects/${seg(org)}/${seg(project)}/builds/${number}/review`,
        { state },
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['build', org, project, number] }),
        queryClient.invalidateQueries({ queryKey: ['project', org, project] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]),
  })
}
