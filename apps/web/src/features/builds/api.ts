import type { Build, Flaky, ReviewState } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, seg } from '#lib/http.ts'

/** Builds still being uploaded or processed; their pages poll until they finish. */
export const isActive = (status: string) =>
  status === 'pending' || status === 'uploading' || status === 'processing'

export const buildQuery = (workspace: string, team: string, number: number) =>
  queryOptions({
    queryKey: ['build', workspace, team, number],
    queryFn: () =>
      getJson<Build.Detail>(`/api/teams/${seg(workspace)}/${seg(team)}/builds/${number}`),
    refetchInterval: (q) => (q.state.data && isActive(q.state.data.build.status) ? 2_000 : false),
  })

/**
 * The screenshots that keep changing on the default branch, so the review list can set them
 * aside. Same key and shape as the team page's, so the two share a cache entry.
 */
export const flakyQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: ['flaky', workspace, team],
    queryFn: () => getJson<Flaky.Report>(`/api/teams/${seg(workspace)}/${seg(team)}/flaky`),
  })

export const fileUrl = (sha256: string) => `/api/files/${sha256}`

/** A decision on a build; rejecting carries the reason the author will read. */
export interface Decision {
  state: ReviewState
  reason?: string
}

/**
 * Approve or reject a build's changes. Afterwards everything that shows the build's state is
 * refetched: its page, the team's builds list and the teams overview.
 */
export function useReviewBuild(workspace: string, team: string, number: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ state, reason }: Decision) =>
      post<{ build: { reviewStatus: ReviewState } }>(
        `/api/teams/${seg(workspace)}/${seg(team)}/builds/${number}/review`,
        reason ? { state, reason } : { state },
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['build', workspace, team, number] }),
        queryClient.invalidateQueries({ queryKey: ['team', workspace, team] }),
        queryClient.invalidateQueries({ queryKey: ['teams'] }),
      ]),
  })
}
