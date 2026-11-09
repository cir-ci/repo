import type { Build, Flaky, ReviewState } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { teamPath } from '#lib/api-paths.ts'
import { getJson, post } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'

/** Builds still being uploaded or processed; their pages poll until they finish. */
export const isActive = (status: string) =>
  status === 'pending' || status === 'uploading' || status === 'processing'

export const buildQuery = (workspace: string, team: string, number: number) =>
  queryOptions({
    queryKey: keys.build(workspace, team, number),
    queryFn: () => getJson<Build.Detail>(teamPath(workspace, team, 'builds', number)),
    refetchInterval: (q) => (q.state.data && isActive(q.state.data.build.status) ? 2_000 : false),
  })

/**
 * The screenshots that keep changing on the default branch, so the review list can set them
 * aside. Same key and shape as the team page's, so the two share a cache entry.
 */
export const flakyQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: keys.flaky(workspace, team),
    queryFn: () => getJson<Flaky.Report>(teamPath(workspace, team, 'flaky')),
  })

export const fileUrl = (sha256: string) => `/api/files/${sha256}`

/** A decision on a build; rejecting carries the reason the author will read. */
export interface Decision {
  state: ReviewState
  reason?: string
}

/** A decision on some snapshots of a build; rejecting carries the reason the author will read. */
export interface SnapshotDecision {
  snapshotNames: string[]
  decision: ReviewState
  reason?: string
}

/**
 * Approve or reject snapshots of a build. The build's own status follows from the decisions, so
 * afterwards everything that shows it is refetched, as for `useReviewBuild`.
 */
export function useReviewSnapshots(workspace: string, team: string, number: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ snapshotNames, decision, reason }: SnapshotDecision) =>
      post<{ build: { reviewStatus: string } }>(
        teamPath(workspace, team, 'builds', number, 'snapshots', 'review'),
        reason ? { snapshotNames, decision, reason } : { snapshotNames, decision },
      ),
    onSuccess: () =>
      invalidateAll(
        queryClient,
        keys.build(workspace, team, number),
        keys.team(workspace, team),
        keys.teams(),
        keys.triage(workspace, team),
      ),
  })
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
        teamPath(workspace, team, 'builds', number, 'review'),
        reason ? { state, reason } : { state },
      ),
    onSuccess: () =>
      invalidateAll(
        queryClient,
        keys.build(workspace, team, number),
        keys.team(workspace, team),
        keys.teams(),
      ),
  })
}
